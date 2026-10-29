// SYSTEM_4 E4-28: a reviewer's own checklist lines on one case — what the predefined checklist misses. The AI cannot
// check them, so open lines hold a passed check for a person; they are never in the customer's email. The database is
// replaced here.

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn(), findAll: jest.fn(async () => []) },
  CaseRequest: { findAll: jest.fn(async () => []), update: jest.fn(async () => [1]), bulkCreate: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(async () => []), findOne: jest.fn(), create: jest.fn() },
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
const { requestInformation, markRequestDone, getEmailDraft } = require('../controllers/cases/requestsController');
const { queueEntry } = require('../modules/review-queue/queue');

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

it('shown apart from the system checklist (area "reviewer"), as the review point "Reviewer checklist open"; never in the customer email', () => {
  const result = withRequests(failed, open);
  const summary = buildAssessmentSummary({ documentCheckResult: result });
  expect(summary.reviewPoints).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'Reviewer checklist', area: 'reviewer', reason: 'Reviewer checklist open' })]));
  expect(summary.lines.filter((l) => l.area === 'documents').map((l) => l.decision)).not.toContain('Reviewer checklist');
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
    CaseRequest.findAll.mockResolvedValueOnce([]).mockResolvedValue(open); // none open before, the new line after
    const r = res();
    await requestInformation(req({ add: [LINE], comment: 'eye test record has no date' }), r);

    expect(r.json).toHaveBeenCalledWith({ caseId: 'c1', previousStatus: 'API_DOCUMENTS_UNSURE', currentStatus: 'API_INCOMPLETE' });
    expect(CaseRequest.bulkCreate).toHaveBeenCalledWith([{ caseId: 'c1', text: LINE, createdBy: 'Ulink (ulink)' }], { transaction: 'tx' });
    const [checkStep, reviewStep] = ApiCaseStep.create.mock.calls.map((c) => c[0]);
    expect(checkStep).toMatchObject({ job: 'api-document-checking', output: { outcome: 'INCOMPLETE', email: null } });
    expect(reviewStep.output.email).toMatchObject({ taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { requested: [LINE], issues: [] } });
  });

  it('email case at "check before emailing": the AI items to the customer, the lines to the team only', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'EMAIL', currentStatus: 'DOCUMENTS_REVIEW', documentCheckResult: failed });
    CaseRequest.findAll.mockResolvedValueOnce([]).mockResolvedValue(open);
    await requestInformation(req({ add: [LINE], comment: 'eye test record has no date' }), res());
    const tasks = queueDedupedTask.mock.calls.map((c) => c[1]);
    expect(tasks.find((t) => t.taskType === 'MISSING_DOCUMENTS').payload.issues.join()).not.toContain(LINE);
    expect(tasks.find((t) => t.taskType === 'DOCUMENTS_INCOMPLETE').payload.requested).toEqual([LINE]);
  });

  it('API case at the claim preparation stop: the line is saved, the case stays, the copy on the check result is refreshed', async () => {
    const atPreparation = { id: 'c1', source: 'API', claimNo: 'CL1', currentStatus: 'API_PREPARATION_REVIEW', toJSON: () => ({ id: 'c1', source: 'API', claimNo: 'CL1' }) };
    const lastCheck = { job: 'api-document-checking', status: 'DONE', createdAt: '2026-10-16T01:00:00Z', output: { outcome: 'INCOMPLETE', documentCheckResult: failed, checkedAt: 'T' } };
    Case.findByPk.mockResolvedValue(atPreparation);
    ApiCaseStep.findAll.mockResolvedValue([lastCheck]);
    ApiCaseStep.findOne.mockResolvedValue(lastCheck);
    CaseRequest.findAll.mockResolvedValueOnce([]).mockResolvedValue(open);
    const r = res();
    await requestInformation(req({ add: [LINE], comment: 'eye test record has no date' }), r);

    expect(r.json).toHaveBeenCalledWith({ caseId: 'c1', previousStatus: 'API_PREPARATION_REVIEW', currentStatus: 'API_PREPARATION_REVIEW' });
    expect(Case.update.mock.calls[0][0]).toEqual({ currentStatus: 'API_PREPARATION_REVIEW' }); // not marked for the review lane
    const [copy, ...rest] = ApiCaseStep.create.mock.calls.map((c) => c[0]);
    expect(rest).toEqual([]); // no new check outcome and no team email: the suspended revision sends it
    expect(copy).toMatchObject({ job: 'api-document-checking', input: { reviewerChecklist: true }, output: { outcome: 'INCOMPLETE', email: null } });
    expect(copy.output.documentCheckResult.checklist).toEqual([expect.objectContaining({ code: 'PERSON_REQUEST' })]);

    // Removing the last line is allowed here: there is no confirm to let the case go on.
    jest.clearAllMocks();
    CaseRequest.findAll.mockResolvedValue(open);
    const r2 = res();
    await requestInformation(req({ remove: ['r1'], comment: 'date found on page 2' }), r2);
    expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'API_PREPARATION_REVIEW' }));
  });

  it('refused away from the documents review statuses, without lines, or without a comment', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'API', currentStatus: 'API_CLAIM_REVISED' });
    const r = res();
    await requestInformation(req({ add: [LINE], comment: 'why not' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    for (const body of [{ add: [], comment: 'why not' }, { add: [LINE] }]) {
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

describe('reviewer checklist rows (SYSTEM_4 E4-29)', () => {
  const res = () => { const r = { status: jest.fn(() => r), json: jest.fn() }; return r; };
  const req = (body, params = {}) => ({ params: { id: 'c1', ...params }, user: { username: 'ulink', name: 'Ulink' }, body });
  const emailCase = { id: 'c1', source: 'EMAIL', currentStatus: 'DOCUMENTS_UNSURE', documentCheckResult: withRequests(passed, open) };

  it('the closed_as list matches the table constraint', () => {
    const migration = require('fs').readFileSync(require('path').join(__dirname, '../db/migrations/20261016140000-case-requests-closed-as.js'), 'utf8');
    const inSql = migration.match(/closed_as IN \(([^)]*)\)/)[1].replace(/'/g, '').split(', ');
    const { CLOSED_AS } = require('fs').readFileSync(require('path').join(__dirname, '../db/models/caseRequest.js'), 'utf8')
      .match(/const CLOSED_AS = \[([^\]]*)\]/).slice(1).reduce((_, list) => ({ CLOSED_AS: list.replace(/'/g, '').split(', ') }), {});
    expect(CLOSED_AS).toEqual(inSql);
  });

  it('a request applies only the change: removed lines closed as removed, the others kept', async () => {
    Case.findByPk.mockResolvedValue(emailCase);
    CaseRequest.findAll.mockResolvedValue([...open, { id: 'r2', text: 'Old line', createdBy: 'X', createdAt: 'T' }]);
    const r = res();
    await requestInformation(req({ add: ['New line'], remove: ['r2'], comment: 'r2 no longer needed' }), r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'INCOMPLETE' }));
    expect(CaseRequest.update).toHaveBeenCalledWith(expect.objectContaining({ closedAs: 'removed' }), expect.objectContaining({ where: expect.objectContaining({ caseId: 'c1' }) }));
    expect(CaseRequest.update).toHaveBeenCalledTimes(1);
    expect(CaseRequest.bulkCreate).toHaveBeenCalledWith([{ caseId: 'c1', text: 'New line', createdBy: 'Ulink (ulink)' }], { transaction: 'tx' });
  });

  it('does not add a line that is already open', async () => {
    Case.findByPk.mockResolvedValue(emailCase);
    CaseRequest.findAll.mockResolvedValue(open);
    const r = res();
    await requestInformation(req({ add: [LINE], comment: 'same line again' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('refuses a change that removes every line, or a line that is no longer open', async () => {
    Case.findByPk.mockResolvedValue(emailCase);
    CaseRequest.findAll.mockResolvedValue(open);
    const r = res();
    await requestInformation(req({ remove: ['r1'], comment: 'all fine' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    const r2 = res();
    await requestInformation(req({ remove: ['gone'], comment: 'all fine' }), r2);
    expect(r2.status).toHaveBeenCalledWith(409);
  });

  it('Done closes one line as done, refreshes the copy on the check result, and does not move the case', async () => {
    Case.findByPk.mockResolvedValueOnce(emailCase).mockResolvedValueOnce({ id: 'c1', documentCheckResult: emailCase.documentCheckResult });
    CaseRequest.findAll.mockResolvedValueOnce(open).mockResolvedValueOnce([]);
    CaseRequest.update.mockResolvedValue([1]);
    const r = res();
    await markRequestDone(req({ comment: 'eye test record dated, page 2' }, { requestId: 'r1' }), r);
    expect(r.json).toHaveBeenCalledWith({ caseId: 'c1', requestId: 'r1', closedAs: 'done' });
    expect(CaseRequest.update.mock.calls[0][0]).toMatchObject({ closedAs: 'done', doneBy: 'Ulink (ulink)' });
    const refreshed = Case.update.mock.calls.find((c) => c[0].documentCheckResult)[0].documentCheckResult;
    expect(refreshed.checklist.find((c) => c.code === 'PERSON_REQUEST')).toBeUndefined();
    expect(Case.update.mock.calls.some((c) => c[0].currentStatus)).toBe(false);
  });

  it('the email draft: the approved template with the open system items and the reviewer lines; none once overridden', async () => {
    Case.findByPk.mockResolvedValue({ id: 'c1', source: 'EMAIL', documentCheckResult: failed });
    const r = res();
    await getEmailDraft(req({ lines: [LINE] }), r);
    const draft = r.json.mock.calls[0][0];
    expect(draft).toMatchObject({ system: ['No Medical Report(s)'], reviewer: [LINE] });
    expect(draft.text).toContain('Dear Valued Customer');
    expect(draft.text).toContain('No Medical Report(s)');
    expect(draft.text).toContain(LINE);

    CaseEvent.findAll.mockResolvedValueOnce([{ reasonCode: 'MANUAL_OVERRIDE', prevStatus: 'DOCUMENTS_REVIEW', createdAt: 'T', message: 'Overridden by X — y: z' }]);
    const r2 = res();
    await getEmailDraft(req({ lines: [] }), r2);
    expect(r2.json.mock.calls[0][0]).toEqual({ system: [], reviewer: [], text: null });
  });

  it('the review queue files a held case under "Reviewer checklist open", before "AI unsure"', () => {
    const entry = queueEntry('DOCUMENTS_UNSURE', { documentCheckResult: withRequests(passed, open) });
    expect(entry.reason).toBe('Reviewer checklist open');
  });
});
