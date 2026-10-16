// SYSTEM_4 E4-11: every manual action on a case says why. Reset and "send the request to the customer" (a held
// missing-documents email) refuse without a comment, and keep it in the case history. Override already required one.

jest.mock('../db/models', () => {
  const events = [];
  return {
    events,
    sequelize: { transaction: (fn) => fn('tx') },
    Case: { findByPk: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
    CaseEvent: { create: jest.fn(async (row) => events.push(row)) },
    ApiCaseStep: { findOne: jest.fn(), create: jest.fn() },
    CaseRequest: { update: jest.fn(async () => [1]) },
  };
});
jest.mock('../modules/document-checking/service', () => ({ releaseMissingDocumentsEmail: jest.fn().mockResolvedValue(true) }));

const { events, Case, ApiCaseStep, CaseRequest } = require('../db/models');
const { releaseMissingDocumentsEmail } = require('../modules/document-checking/service');
const { resetCase, releaseMissingDocuments } = require('../controllers/cases/casesController');
const { resetOneCase } = require('../controllers/dev/casesController');

const user = { username: 'ops1', name: 'Ops' };
const call = async (handler, body) => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await handler({ params: { id: 'case-1' }, body, user }, res);
  return res;
};

beforeEach(() => { jest.clearAllMocks(); events.length = 0; });

describe('reset', () => {
  it('refuses without a comment, before touching the case', async () => {
    for (const body of [undefined, {}, { comment: '  ' }, { comment: 'ok' }]) {
      const res = await call(resetCase, body);
      expect(res).toMatchObject({ statusCode: 400, body: { error: { message: 'Add a comment: why you reset this case.' } } });
    }
    expect(Case.findByPk).not.toHaveBeenCalled();
  });

  it('keeps the comment in the case history', async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', currentStatus: 'MANUAL_REVIEW', claimNo: null });
    const res = await call(resetCase, { comment: ' Customer resent a clearer voucher ' });
    expect(res.statusCode).toBe(200);
    expect(events[0]).toMatchObject({ reasonCode: 'MANUAL_RESET' });
    expect(events[0].message).toMatch(/^Reset via console by ops1 — comment: Customer resent a clearer voucher, cleared: /);
  });

  it('the dev reset tool still works without one', async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', currentStatus: 'MANUAL_REVIEW', claimNo: null });
    await resetOneCase('case-1', 'READY_FOR_DOCUMENT_READING');
    expect(events[0].message).toMatch(/^Reset via dev tool, cleared: /);
  });

  it("closes a reviewer's open lines when the document check is cleared (SYSTEM_4 E4-28)", async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', currentStatus: 'DOCUMENTS_UNSURE', claimNo: null });
    await resetOneCase('case-1', 'READY_FOR_DOCUMENT_READING');
    expect(CaseRequest.update).toHaveBeenCalledWith({ doneBy: 'reset (dev tool)', doneAt: expect.any(Date), closedAs: 'reset' }, { where: { caseId: 'case-1', doneAt: null }, transaction: undefined });
  });
});

describe('send the request to the customer (held email)', () => {
  it('refuses without a comment', async () => {
    const res = await call(releaseMissingDocuments, {});
    expect(res).toMatchObject({ statusCode: 400, body: { error: { message: 'Add a comment: why the documents really are missing.' } } });
    expect(Case.findByPk).not.toHaveBeenCalled();
  });

  it('email case: passes the comment to the case history', async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', source: 'EMAIL', currentStatus: 'DOCUMENTS_REVIEW' });
    const res = await call(releaseMissingDocuments, { comment: 'Checked page 3 — no medical report' });
    expect(res.body).toEqual({ caseId: 'case-1', currentStatus: 'INCOMPLETE' });
    expect(releaseMissingDocumentsEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-1' }), 'Ops (ops1)', 'Checked page 3 — no medical report');
  });

  it('API case: the comment is in the case history and on the review step', async () => {
    Case.findByPk.mockResolvedValue({ id: 'case-1', source: 'API', currentStatus: 'API_DOCUMENTS_REVIEW' });
    ApiCaseStep.findOne.mockResolvedValue({ output: { heldEmail: { taskType: 'MISSING_DOCUMENTS' } } });
    const res = await call(releaseMissingDocuments, { comment: 'Checked page 3 — no medical report' });
    expect(res.body).toEqual({ caseId: 'case-1', currentStatus: 'API_INCOMPLETE' });
    expect(events[0].message).toBe('Missing-documents email sent to the customer by Ops (ops1) after review — comment: Checked page 3 — no medical report');
    expect(ApiCaseStep.create.mock.calls[0][0].input).toMatchObject({ action: 'release-missing-documents', comment: 'Checked page 3 — no medical report' });
  });
});
