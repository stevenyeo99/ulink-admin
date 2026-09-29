// Switch "hold the missing-documents email when the AI is unsure" — API cases: an unsure incomplete case
// waits at API_DOCUMENTS_REVIEW (no customer email, no suspended revision yet); overridden, it is revised
// as complete (2026-09-29).

jest.mock('../modules/document-checking/service', () => ({ checkCase: jest.fn() }));
jest.mock('../modules/settings/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/service', () => ({ checkCase: jest.fn() }));

const documentChecking = require('../modules/document-checking/service');
const { getSettings } = require('../modules/settings/settings');
const iasPreparation = require('../modules/ias-claim-preparation/service');
const { job: documentJob } = require('../modules/api-document-checking/service');
const { job: preparationJob } = require('../modules/api-claim-preparation/service');

const caseRecord = { id: 'case-1', source: 'API', claimNo: '2609290001', createdAt: '2026-09-29T01:00:00Z' };
const input = { 'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields: {} } };
const incomplete = (confidence) => ({
  outcome: 'INCOMPLETE',
  result: { passed: false, issues: ['No medical report'], details: [], checklist: [{ code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence }] },
});

beforeEach(() => jest.clearAllMocks());

it('holds an unsure incomplete case for a person: team told, customer email kept aside', async () => {
  getSettings.mockResolvedValue({ holdUnsureMissingDocsEmail: true });
  documentChecking.checkCase.mockResolvedValue(incomplete(0.3));
  const result = await documentJob.process({ caseRecord, input });
  expect(result.nextStatus).toBe('API_DOCUMENTS_REVIEW');
  expect(result.output.email).toMatchObject({ taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { held: ['Medical report present (AI confidence 0.3)'] } });
  expect(result.output.heldEmail).toMatchObject({ taskType: 'MISSING_DOCUMENTS', audience: 'customer' });
});

it('switch off, or the AI sure: as before — API_INCOMPLETE and the customer email', async () => {
  getSettings.mockResolvedValue({ holdUnsureMissingDocsEmail: false });
  documentChecking.checkCase.mockResolvedValue(incomplete(0.3));
  expect(await documentJob.process({ caseRecord, input })).toMatchObject({ nextStatus: 'API_INCOMPLETE', output: { email: { taskType: 'MISSING_DOCUMENTS' } } });

  getSettings.mockResolvedValue({ holdUnsureMissingDocsEmail: true });
  documentChecking.checkCase.mockResolvedValue(incomplete(0.95));
  expect((await documentJob.process({ caseRecord, input })).nextStatus).toBe('API_INCOMPLETE');
});

it('a held case a person overrode is revised as documents complete (no suspense)', async () => {
  iasPreparation.checkCase.mockResolvedValue({ payload: { Items: [] }, diagnosis: null, lines: [], isStp: false, claimPrepMeta: {} });
  const result = await preparationJob.process({
    caseRecord: { ...caseRecord, currentStatus: 'API_DOCUMENTS_VERIFIED' },
    input: {
      'api-claim-intake': { clNo: '2609290001', tpaCaseNumber: 'AYA-CL-26031486' },
      'api-material-download': { documents: [] },
      'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields: {} },
      'api-member-verification': { iasMemberInfoResponse: {} },
      'api-document-checking': { outcome: 'INCOMPLETE', checkedAt: '2026-09-29T02:00:00Z', documentCheckResult: { passed: false } },
      'case-override': { from: 'API_DOCUMENTS_REVIEW', note: 'Overridden by Ops — The AI misread the documents: record on page 3' },
    },
  });
  expect(result.output.documentsComplete).toBe(true);
  expect(result.output.payload).toMatchObject({ isSuspense: 'N' });
  expect(preparationJob.optionalInputs).toContain('case-override');
});
