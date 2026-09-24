// Case detail (GET /api/cases/:id): API cases get their page fields filled from their job steps;
// email cases get exactly the response they always had. Models are mocked.

jest.mock('../db/models', () => ({
  Case: { findByPk: jest.fn() },
  CaseEvent: { findAll: jest.fn(async () => [{ id: 'ev-1' }]) },
  CaseDocument: { findAll: jest.fn(async () => []) },
  ApiCaseStep: { findAll: jest.fn() },
  EmailThread: {},
  EmailMessage: {},
  EmailAttachment: {},
}));

const { Case, ApiCaseStep } = require('../db/models');
const { getCase } = require('../controllers/cases/casesController');
const { apiCaseView } = require('../modules/api-pipeline/caseView');

const step = (job, output, createdAt, status = 'DONE') => ({ job, status, output, createdAt: new Date(createdAt) });

describe('apiCaseView', () => {
  it("maps each job's latest DONE output to the case fields the page reads", () => {
    const view = apiCaseView([
      step('api-claim-recognition', { recognizedType: 'ayas_member_claim', extractedFields: { v: 1 } }, '2026-09-24T01:00Z'),
      step('api-claim-recognition', { recognizedType: 'ayas_member_claim', extractedFields: { v: 2 } }, '2026-09-24T03:00Z'),
      step('api-claim-recognition', null, '2026-09-24T04:00Z', 'FAILED'), // a later failure doesn't hide the last result
      step('api-member-verification', { memberVerifyResult: { m: 1 }, iasMemberInfoResponse: { i: 1 } }, '2026-09-24T02:00Z'),
      step('api-document-checking', { documentCheckResult: { issues: [] } }, '2026-09-24T02:00Z'),
      step('api-claim-preparation', { payload: { claimNo: 'C1' }, claimPrepMeta: { lines: [] }, isStp: false }, '2026-09-24T02:00Z'),
      step('api-claim-revision', { response: { success: true } }, '2026-09-24T02:00Z'),
    ]);
    expect(view).toEqual({
      recognizedType: 'ayas_member_claim',
      extractedFields: { v: 2 },
      memberVerifyResult: { m: 1 },
      iasMemberInfoResponse: { i: 1 },
      documentCheckResult: { issues: [] },
      iasClaimPayload: { claimNo: 'C1' },
      claimPrepMeta: { lines: [] },
      isStp: false,
      iasClaimResult: { success: true },
    });
  });

  it('adds nothing for jobs that have not produced output yet', () => {
    expect(apiCaseView([step('api-claim-intake', { clNo: '1' }, '2026-09-24T01:00Z')])).toEqual({});
  });
});

describe('getCase', () => {
  const call = async () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await getCase({ params: { id: 'case-1' } }, res);
    return res.json.mock.calls[0][0];
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns an email case exactly as before: same keys, no step lookup', async () => {
    const emailCase = { id: 'case-1', source: 'EMAIL', extractedFields: { real: true }, toJSON: jest.fn() };
    Case.findByPk.mockResolvedValue(emailCase);

    const body = await call();

    expect(Object.keys(body)).toEqual(['case', 'events', 'documents']);
    expect(body.case).toBe(emailCase); // the model instance itself, untouched
    expect(ApiCaseStep.findAll).not.toHaveBeenCalled();
  });

  it('fills an API case from its steps and includes the steps', async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', source: 'API', toJSON: () => ({ id: 'case-1', source: 'API', extractedFields: null }) });
    const steps = [step('api-claim-recognition', { recognizedType: 'ayas_member_claim', extractedFields: { v: 1 } }, '2026-09-24T01:00Z')];
    ApiCaseStep.findAll.mockResolvedValue(steps);

    const body = await call();

    expect(body.case).toMatchObject({ id: 'case-1', source: 'API', recognizedType: 'ayas_member_claim', extractedFields: { v: 1 } });
    expect(body.apiSteps).toBe(steps);
  });
});
