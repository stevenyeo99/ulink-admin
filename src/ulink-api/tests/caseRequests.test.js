// SYSTEM_4 E4-28: a reviewer's own checklist lines on one case — what the predefined checklist misses. The AI cannot
// check them, so open lines hold a passed check for a person; they are never in the customer's email. The database is
// replaced here.

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn(), findAll: jest.fn(async () => []) },
  CaseRequest: { findAll: jest.fn(async () => []), update: jest.fn(), bulkCreate: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(async () => []), create: jest.fn() },
  CaseClaim: { destroy: jest.fn() },
  Setting: { findAll: jest.fn(async () => []) },
}));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));
jest.mock('../modules/document-checking/service', () => ({ ...jest.requireActual('../modules/document-checking/service'), checkCase: jest.fn() }));

const { Case, CaseRequest, ApiCaseStep, CaseEvent } = require('../db/models');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const documentChecking = require('../modules/document-checking/service');
const { job: apiDocumentJob, emailFor } = require('../modules/api-document-checking/service');
const { validateLines, withRequests } = require('../modules/case-requests/requests');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { render } = require('../modules/email-sender/templates');
const { requestInformation } = require('../controllers/cases/requestsController');

const LINE = 'Need to fill treatment date in the eye test record';
const open = [{ id: 'r1', text: LINE, createdBy: 'Ulink (ulink)', createdAt: '2026-10-16T02:00:00Z' }];
const passed = { passed: true, issues: [], details: [], checklist: [] };
const failed = { passed: false, issues: ['No Medical Report(s)'], details: [], checklist: [] };
beforeEach(() => { jest.clearAllMocks(); CaseRequest.findAll.mockResolvedValue([]); });

it('lines: at least one, at most 10, each at most 300 characters, repeats once', () => {
  expect(validateLines([' a ', 'a', ''])).toEqual({ lines: ['a'] });
  expect(validateLines([]).error).toBeDefined();
  expect(validateLines(Array(11).fill(0).map((_, i) => `l${i}`)).error).toBeDefined();
  expect(validateLines(['x'.repeat(301)]).error).toBeDefined();
});

it('email case: an open line holds a passed check for a person, whatever switch #3 says', async () => {
  CaseRequest.findAll.mockResolvedValue(open);
  await documentChecking.persistOutcome({ id: 'c1', currentStatus: 'READY_FOR_DOCUMENT_CHECKING' }, { outcome: 'DOCUMENT_CHECKED', result: passed });
  expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'DOCUMENTS_UNSURE' });
  expect(Case.update.mock.calls[0][0].documentCheckResult.checklist).toEqual([expect.objectContaining({ code: 'PERSON_REQUEST' })]);
  expect(CaseEvent.create.mock.calls[0][0].message).toContain(LINE);

  jest.clearAllMocks();
  CaseRequest.findAll.mockResolvedValue([]);
  await documentChecking.persistOutcome({ id: 'c1', currentStatus: 'READY_FOR_DOCUMENT_CHECKING' }, { outcome: 'DOCUMENT_CHECKED', result: passed });
  expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'MEMBER_VERIFIED' });
});

it('API case: an open line holds a passed check before the IAS revision', async () => {
  CaseRequest.findAll.mockResolvedValue(open);
  documentChecking.checkCase.mockResolvedValue({ outcome: 'DOCUMENT_CHECKED', result: passed });
  const out = await apiDocumentJob.process({ caseRecord: { id: 'c1', source: 'API' }, input: { 'api-claim-recognition': { extractedFields: {} } } });
  expect(out.nextStatus).toBe('API_DOCUMENTS_UNSURE');
  expect(out.message).toContain(LINE);
});

it('shown as a review point "Requested by a person"; never in the customer email', () => {
  const result = withRequests(failed, open);
  const summary = buildAssessmentSummary({ documentCheckResult: result });
  expect(summary.reviewPoints).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'Requested by a person' })]));
  expect(JSON.stringify(emailFor(result))).not.toContain(LINE);
  expect(render('MISSING_DOCUMENTS', emailFor(result).payload).bodyText).not.toContain(LINE);
});

it('the team email asks the team to contact the customer about the lines', () => {
  const { subject, bodyText } = render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', claimNo: 'CL1', issues: [], requested: [LINE] });
  expect(subject).toBe('(ULINK AI) Contact the customer — information requested — Claim CL1 — 1 line');
  expect(bodyText).toContain('It is NOT in any email to the customer');
  expect(bodyText).toContain(`1. ${LINE}`);
});

describe('POST /api/cases/:id/request-information', () => {
  const res = () => { const r = { status: jest.fn(() => r), json: jest.fn() }; return r; };
  const req = (body) => ({ params: { id: 'c1' }, user: { username: 'ulink', name: 'Ulink' }, body });

  it('API case at "check the AI finding": suspended revision, no customer email, the team told to contact the customer', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'API', claimNo: 'CL1', currentStatus: 'API_DOCUMENTS_UNSURE', toJSON: () => ({ id: 'c1', source: 'API', claimNo: 'CL1' }) });
    ApiCaseStep.findAll.mockResolvedValue([{ job: 'api-document-checking', status: 'DONE', createdAt: '2026-10-16T01:00:00Z', output: { outcome: 'DOCUMENT_CHECKED', documentCheckResult: passed, checkedAt: 'T' } }]);
    CaseRequest.findAll.mockResolvedValue(open);
    const r = res();
    await requestInformation(req({ lines: [LINE], comment: 'eye test record has no date' }), r);

    expect(r.json).toHaveBeenCalledWith({ caseId: 'c1', previousStatus: 'API_DOCUMENTS_UNSURE', currentStatus: 'API_INCOMPLETE' });
    expect(CaseRequest.bulkCreate).toHaveBeenCalledWith([{ caseId: 'c1', text: LINE, createdBy: 'Ulink (ulink)' }], { transaction: 'tx' });
    const [checkStep, reviewStep] = ApiCaseStep.create.mock.calls.map((c) => c[0]);
    expect(checkStep).toMatchObject({ job: 'api-document-checking', output: { outcome: 'INCOMPLETE', email: null } });
    expect(reviewStep.output.email).toMatchObject({ taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { requested: [LINE], issues: [] } });
  });

  it('email case at "check before emailing": the AI items to the customer, the lines to the team only', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'EMAIL', currentStatus: 'DOCUMENTS_REVIEW', documentCheckResult: failed });
    CaseRequest.findAll.mockResolvedValue(open);
    await requestInformation(req({ lines: [LINE], comment: 'eye test record has no date' }), res());
    const tasks = queueDedupedTask.mock.calls.map((c) => c[1]);
    expect(tasks.find((t) => t.taskType === 'MISSING_DOCUMENTS').payload.issues.join()).not.toContain(LINE);
    expect(tasks.find((t) => t.taskType === 'DOCUMENTS_INCOMPLETE').payload.requested).toEqual([LINE]);
  });

  it('refused away from the documents review statuses, without lines, or without a comment', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'API', currentStatus: 'API_CLAIM_REVISED' });
    const r = res();
    await requestInformation(req({ lines: [LINE], comment: 'why not' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    for (const body of [{ lines: [], comment: 'why not' }, { lines: [LINE] }]) {
      const r2 = res();
      await requestInformation(req(body), r2);
      expect(r2.status).toHaveBeenCalledWith(400);
    }
  });
});

it('a requested line is not offered as a check to correct', () => {
  const { correctionOptions } = require('../modules/ai-feedback/corrections');
  expect(correctionOptions({}, withRequests(passed, open)).some((o) => o.item === 'PERSON_REQUEST')).toBe(false);
});
