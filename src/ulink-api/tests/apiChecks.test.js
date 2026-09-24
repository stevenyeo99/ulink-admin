// api-member-verification / api-document-checking: both hand the OCR output to the email flow's
// own (unchanged) checkCase and map its outcome to API statuses. The email checks are mocked —
// what matters is the input they get and how their answers are mapped.

jest.mock('../modules/member-verification/service', () => ({ checkCase: jest.fn() }));
jest.mock('../modules/document-checking/service', () => ({ checkCase: jest.fn() }));

const memberEmail = require('../modules/member-verification/service');
const documentEmail = require('../modules/document-checking/service');
const { job: memberJob } = require('../modules/api-member-verification/service');
const { job: documentJob } = require('../modules/api-document-checking/service');

const extractedFields = { claimant: { claimant_nrc_passport: '12/ABC(N)123456' } };
const input = { 'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields, pageCount: 7 } };
const recognized = { id: 'case-1', currentStatus: 'API_RECOGNIZED' };

beforeEach(() => jest.clearAllMocks());

describe('api-member-verification', () => {
  it('takes the OCR output and re-checks cases waiting on a member issue', () => {
    expect(memberJob).toMatchObject({ inputStatus: ['API_RECOGNIZED', 'API_MEMBER_REVIEW_REQUIRED'], inputs: ['api-claim-recognition'] });
  });

  it("passes the extracted fields to the email flow's member check and moves on when verified", async () => {
    memberEmail.checkCase.mockResolvedValue({ outcome: 'MEMBER_VERIFIED', result: { reasonCode: null }, iasResponse: { success: true } });

    const result = await memberJob.process({ caseRecord: recognized, input });

    expect(memberEmail.checkCase).toHaveBeenCalledWith({ id: 'case-1', extractedFields, recognizedType: 'ayas_member_claim' });
    expect(result).toMatchObject({
      nextStatus: 'API_READY_FOR_DOCUMENT_CHECKING',
      output: { outcome: 'MEMBER_VERIFIED', memberVerifyResult: { reasonCode: null }, iasMemberInfoResponse: { success: true }, email: null },
    });
  });

  it('sends a member issue to review, with the internal email the email flow would send', async () => {
    memberEmail.checkCase.mockResolvedValue({ outcome: 'MEMBER_REVIEW_REQUIRED', result: { reasonCode: 'MEMBER_NOT_FOUND' }, iasResponse: {} });
    const result = await memberJob.process({ caseRecord: recognized, input });
    expect(result).toMatchObject({
      nextStatus: 'API_MEMBER_REVIEW_REQUIRED',
      output: { email: { taskType: 'MEMBER_VERIFY_ISSUE', audience: 'internal' } },
    });
  });

  it('keeps waiting when a re-check still fails, and moves on once IAS is fixed', async () => {
    const waiting = { id: 'case-1', currentStatus: 'API_MEMBER_REVIEW_REQUIRED' };

    memberEmail.checkCase.mockResolvedValue({ outcome: 'MEMBER_REVIEW_REQUIRED', result: { reasonCode: 'MEMBER_NOT_FOUND' }, iasResponse: {} });
    expect(await memberJob.process({ caseRecord: waiting, input })).toMatchObject({ wait: true });

    memberEmail.checkCase.mockResolvedValue({ outcome: 'MEMBER_VERIFIED', result: {}, iasResponse: {} });
    expect(await memberJob.process({ caseRecord: waiting, input })).toMatchObject({ nextStatus: 'API_READY_FOR_DOCUMENT_CHECKING' });
  });
});

describe('api-document-checking', () => {
  const ready = { id: 'case-1', currentStatus: 'API_READY_FOR_DOCUMENT_CHECKING' };

  it('runs after the member check, on the OCR output', () => {
    expect(documentJob).toMatchObject({ inputStatus: 'API_READY_FOR_DOCUMENT_CHECKING', inputs: ['api-claim-recognition'] });
  });

  it("passes the extracted fields to the email flow's document check and verifies complete documents", async () => {
    documentEmail.checkCase.mockResolvedValue({ outcome: 'DOCUMENT_CHECKED', result: { passed: true, issues: [] } });

    const result = await documentJob.process({ caseRecord: ready, input });

    expect(documentEmail.checkCase).toHaveBeenCalledWith({ id: 'case-1', extractedFields, recognizedType: 'ayas_member_claim' });
    expect(result).toMatchObject({
      nextStatus: 'API_DOCUMENTS_VERIFIED',
      output: { outcome: 'DOCUMENT_CHECKED', email: { taskType: 'DOCUMENT_COMPLETE_ACK', audience: 'customer' } },
    });
  });

  it('marks missing documents incomplete, with the customer email the email flow would send', async () => {
    documentEmail.checkCase.mockResolvedValue({ outcome: 'INCOMPLETE', result: { passed: false, issues: ['No Medical Report(s)'] } });
    const result = await documentJob.process({ caseRecord: ready, input });
    expect(result).toMatchObject({
      nextStatus: 'API_INCOMPLETE',
      message: expect.stringContaining('No Medical Report(s)'),
      output: { documentCheckResult: { issues: ['No Medical Report(s)'] }, email: { taskType: 'MISSING_DOCUMENTS', audience: 'customer' } },
    });
  });
});
