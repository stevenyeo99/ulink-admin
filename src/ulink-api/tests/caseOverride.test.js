// Manual override (modules/case-override/override.js, POST /api/cases/:id/override): which cases a
// reviewer can let past a wrongly flagged check, what is required, and what gets recorded.
// Models are mocked.

jest.mock('../db/models', () => ({
  sequelize: { transaction: jest.fn(async (fn) => fn('tx')) },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(async () => []), create: jest.fn() },
  CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {},
}));

const { Case, CaseEvent, ApiCaseStep } = require('../db/models');
const { overrideCheck, overridesFromEvents } = require('../modules/case-override/override');
const { overrideCase } = require('../controllers/cases/casesController');

const user = { id: 'u1', username: 'ulink', name: 'Ulink', role: 'super_admin' };
const call = async (body, caseRecord) => {
  Case.findByPk.mockResolvedValue(caseRecord);
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await overrideCase({ params: { id: 'c1' }, body, user }, res);
  return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
};

beforeEach(() => jest.clearAllMocks());

describe('which cases can be overridden', () => {
  it('lets the document check and the member check (email and API) through to where a pass would go', () => {
    expect(overrideCheck('INCOMPLETE')).toEqual({ allowed: true, target: 'MEMBER_VERIFIED' });
    expect(overrideCheck('MEMBER_REVIEW_REQUIRED')).toEqual({ allowed: true, target: 'READY_FOR_DOCUMENT_CHECKING' });
    expect(overrideCheck('API_MEMBER_REVIEW_REQUIRED')).toEqual({ allowed: true, target: 'API_READY_FOR_DOCUMENT_CHECKING' });
  });

  it('refuses other statuses, and a member that IAS does not have', () => {
    expect(overrideCheck('API_CLAIM_SUSPENDED')).toEqual({ allowed: false, reason: null });
    expect(overrideCheck('CSR_SENT')).toEqual({ allowed: false, reason: null });
    const notFound = overrideCheck('MEMBER_REVIEW_REQUIRED', { memberVerifyResult: { reasonCode: 'MEMBER_NOT_FOUND' } });
    expect(notFound).toMatchObject({ allowed: false, reason: expect.stringContaining('not found in IAS') });
  });
});

describe('POST /api/cases/:id/override', () => {
  const emailCase = {
    id: 'c1', source: 'EMAIL', currentStatus: 'INCOMPLETE',
    documentCheckResult: { checklist: [{ code: 'INCOMPLETE_MEDICAL_REPORT', label: 'x', passed: false }] },
  };

  it('needs a reason and a finding', async () => {
    expect((await call({ finding: 'AI_MISREAD' }, emailCase)).status).toBe(400);
    expect((await call({ reason: 'ok', finding: 'BECAUSE' }, emailCase)).status).toBe(400);
    expect(Case.update).not.toHaveBeenCalled();
  });

  it('moves an email case on, only from the status it was reviewed at, and records who, why and what was waived', async () => {
    const { status, body } = await call({ reason: 'Record is legible on page 3.', finding: 'AI_MISREAD' }, emailCase);

    expect(status).toBe(200);
    expect(body).toEqual({ caseId: 'c1', previousStatus: 'INCOMPLETE', currentStatus: 'MEMBER_VERIFIED' });
    expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'MEMBER_VERIFIED' }, { where: { id: 'c1', currentStatus: 'INCOMPLETE' }, transaction: 'tx' });
    const { message, reasonCode } = CaseEvent.create.mock.calls[0][0];
    expect(reasonCode).toBe('MANUAL_OVERRIDE');
    expect(message).toContain('Overridden by Ulink (ulink) — The AI misread the documents: Record is legible on page 3.');
    expect(message).toContain('waived: Medical record readable: Unreadable');
    expect(ApiCaseStep.create).not.toHaveBeenCalled();
  });

  it('moves an API member-check case on and adds the override to its job history', async () => {
    ApiCaseStep.findAll.mockResolvedValue([{
      job: 'api-member-verification', status: 'DONE', createdAt: new Date(),
      output: { memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x' } },
    }]);
    const apiCase = { id: 'c1', source: 'API', currentStatus: 'API_MEMBER_REVIEW_REQUIRED' };

    const { body } = await call({ reason: 'Bank confirmed by phone.', finding: 'CUSTOMER_CONFIRMED' }, apiCase);

    expect(body.currentStatus).toBe('API_READY_FOR_DOCUMENT_CHECKING');
    expect(ApiCaseStep.create).toHaveBeenCalledWith(expect.objectContaining({
      job: 'case-override',
      status: 'DONE',
      input: { username: 'ulink', finding: 'CUSTOMER_CONFIRMED', reason: 'Bank confirmed by phone.' },
      output: expect.objectContaining({ from: 'API_MEMBER_REVIEW_REQUIRED', to: 'API_READY_FOR_DOCUMENT_CHECKING' }),
    }), { transaction: 'tx' });
  });

  it('refuses a member not found in IAS, and a case that moved while it was being reviewed', async () => {
    const notFound = { ...emailCase, currentStatus: 'MEMBER_REVIEW_REQUIRED', memberVerifyResult: { reasonCode: 'MEMBER_NOT_FOUND' } };
    expect((await call({ reason: 'x', finding: 'OTHER' }, notFound)).status).toBe(400);

    Case.update.mockResolvedValueOnce([0]);
    const moved = await call({ reason: 'x', finding: 'OTHER' }, emailCase);
    expect(moved.status).toBe(409);
    expect(CaseEvent.create).not.toHaveBeenCalled();
  });
});

describe('overridesFromEvents', () => {
  it("reads the case history's override entries, without the waived list", () => {
    expect(overridesFromEvents([
      { reasonCode: 'MANUAL_OVERRIDE', prevStatus: 'API_MEMBER_REVIEW_REQUIRED', createdAt: 't1', message: 'Overridden by Ulink (ulink) — Other (see reason): ok (waived: Member check: Data mismatch)' },
      { reasonCode: 'MANUAL_RESET', prevStatus: 'INCOMPLETE', createdAt: 't2', message: 'Reset' },
    ])).toEqual([{ area: 'member', at: 't1', note: 'Overridden by Ulink (ulink) — Other (see reason): ok' }]);
  });
});
