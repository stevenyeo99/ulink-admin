// Human-in-the-loop switches (2026-09-29), both off by default:
// #1 stpBlockOnReviewPoints — a claim with an open review point never goes STP;
// #2 holdUnsureMissingDocsEmail — when the AI is unsure a document is missing, the customer's email
//    waits for a person (send it, or override the check).

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { update: jest.fn().mockResolvedValue([1]), findAll: jest.fn() },
  CaseEvent: { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
  Setting: { findAll: jest.fn(), upsert: jest.fn() },
  StpRule: { findAll: jest.fn() },
  StpBlockedDiagnosis: { findAll: jest.fn() },
  ClaimRoute: { findOne: jest.fn() },
}));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));

const { Case, Setting } = require('../db/models');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const { unsureDocumentPoints } = require('../modules/document-checking/holdForReview');
const { setSettings } = require('../modules/settings/settings');
const documentChecking = require('../modules/document-checking/service');
const { render } = require('../modules/email-sender/templates');

const switches = (on) => Setting.findAll.mockResolvedValue(on ? [{ key: 'holdUnsureMissingDocsEmail', value: true }] : []);
beforeEach(() => jest.clearAllMocks());

describe('#1 open review point blocks STP', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: '50000' }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', diagCode: 'J06.9', lines: [{ benefitType: 'OP', subtotal: 30000 }], openReviewPoints: [{ decision: 'Medical record present', reason: 'AI unsure' }] };

  it('switch off: STP as before, whatever the review points', () => {
    expect(evaluateStp(config, input).isStp).toBe(true);
  });

  it('switch on: an open review point stops STP, and says which', () => {
    expect(evaluateStp({ ...config, blockOnReviewPoints: true }, input))
      .toMatchObject({ isStp: false, reasons: ['Open review point: Medical record present (AI unsure) — a person checks first.'] });
    expect(evaluateStp({ ...config, blockOnReviewPoints: true }, { ...input, openReviewPoints: [] }).isStp).toBe(true);
  });
});

describe('#2 what counts as "the AI is unsure a document is missing"', () => {
  it('a document it could not read, or a missing finding below 0.5 confidence — not a plainly missing item', () => {
    expect(unsureDocumentPoints({ checklist: [
      { code: 'INCOMPLETE_MEDICAL_REPORT', label: 'Medical report legible', passed: false },
      { code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: 0.3 },
      { code: 'MISSING_BANK_INFO', label: 'Bank information', passed: false },
      { code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: 0.9 },
      { code: 'UNCLEAR_VOUCHER', label: 'Voucher readable', passed: true },
    ] })).toEqual(['Medical report legible (could not read clearly)', 'Medical report present (AI confidence 0.3)']);
  });
});

describe('#2 email case: holding the customer email', () => {
  const result = (unsure) => ({
    passed: false,
    issues: ['No medical report'],
    details: [],
    checklist: [{ code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: unsure ? 0.3 : 0.95 }],
  });
  const caseRecord = { id: 'case-1', currentStatus: 'READY_FOR_DOCUMENT_CHECKING', createdAt: '2026-09-29T01:00:00Z' };
  const persist = (unsure) => documentChecking.persistOutcome(caseRecord, { outcome: 'INCOMPLETE', result: result(unsure) });
  const taskTypes = () => queueDedupedTask.mock.calls.map(([, t]) => t.taskType);

  it('switch on + AI unsure: no customer email, case waits for a person, team told what to check', async () => {
    switches(true);
    await persist(true);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'DOCUMENTS_REVIEW' });
    expect(taskTypes()).toEqual(['DOCUMENTS_INCOMPLETE']);
    expect(queueDedupedTask.mock.calls[0][1].payload.held).toEqual(['Medical report present (AI confidence 0.3)']);
  });

  it('switch on + AI sure, or switch off: the customer is emailed as before', async () => {
    switches(true);
    await persist(false);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'INCOMPLETE' });
    expect(taskTypes()).toEqual(['MISSING_DOCUMENTS', 'DOCUMENTS_INCOMPLETE']);

    jest.clearAllMocks();
    switches(false);
    await persist(true);
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'INCOMPLETE' });
    expect(taskTypes()).toEqual(['MISSING_DOCUMENTS', 'DOCUMENTS_INCOMPLETE']);
  });

  it('a person confirms the documents are missing: the customer gets the request', async () => {
    const held = { id: 'case-1', documentCheckResult: result(true) };
    expect(await documentChecking.releaseMissingDocumentsEmail(held, 'Ops (ops1)')).toBe(true);
    expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'INCOMPLETE' }, expect.objectContaining({ where: { id: 'case-1', currentStatus: 'DOCUMENTS_REVIEW' } }));
    expect(taskTypes()).toEqual(['MISSING_DOCUMENTS']);

    Case.update.mockResolvedValueOnce([0]); // moved meanwhile
    expect(await documentChecking.releaseMissingDocumentsEmail(held, 'Ops (ops1)')).toBe(false);
  });
});

it('the team email says the customer has not been emailed and what to check', () => {
  const email = render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', issues: ['No medical report'], held: ['Medical report present (AI confidence 0.3)'] });
  expect(email.subject).toBe('(ULINK AI) Check before emailing the customer — Case c1 — 1 missing');
  expect(email.bodyText).toContain('ACTION NEEDED — the customer has NOT been emailed yet. The AI was unsure about: Medical report present (AI confidence 0.3).');
});

it('switches accept only known keys and true/false, saved with the rest of the form', async () => {
  await setSettings({ stpBlockOnReviewPoints: true }, 'admin', { transaction: 'tx' });
  expect(Setting.upsert).toHaveBeenCalledWith({ key: 'stpBlockOnReviewPoints', value: true, updatedBy: 'admin' }, { transaction: 'tx' });
  await expect(setSettings({ somethingElse: true })).rejects.toThrow('Unknown setting');
  await expect(setSettings({ stpBlockOnReviewPoints: 'yes' })).rejects.toThrow('true or false');
});
