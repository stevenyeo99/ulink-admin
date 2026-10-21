// Human-in-the-loop switches (2026-09-29), both off by default:
// #1 stpBlockOnReviewPoints — a claim with an open review point never goes STP;
// #2 holdUnsureMissingDocsEmail — when the AI is unsure a document is missing, the customer's email
//    waits for a person (send it, or override the check).

jest.mock('../db/models', () => ({
  CaseRequest: { findAll: jest.fn(async () => []), update: jest.fn(async () => [0]) }, // reviewer's own lines (SYSTEM_4 E4-28): none
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
  it('a document it could not read, or a missing finding at or below the threshold — not a plainly missing item', () => {
    expect(unsureDocumentPoints({ checklist: [
      { code: 'INCOMPLETE_MEDICAL_REPORT', label: 'Medical report legible', passed: false },
      { code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: 0.3 },
      { code: 'MISSING_BANK_INFO', label: 'Bank information', passed: false },
      { code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: 0.9 },
      { code: 'UNCLEAR_VOUCHER', label: 'Voucher readable', passed: true },
    ] })).toEqual(['Medical report legible (could not read clearly)', 'Medical report present (AI confidence 0.3)']);
  });

  it('exactly 0.5 confidence, and any date mismatch, is unsure (2026-10-01, cases 04759562 / 42214c2a)', () => {
    expect(unsureDocumentPoints({ checklist: [
      { code: 'NO_MEDICAL_REPORT', label: 'Medical report present', passed: false, confidence: 0.5 },
      { code: 'INVOICE_DATE_INCONSISTENT', label: 'Invoice date(s) are consistent with medical record date', passed: false, confidence: 1 },
      { code: 'TREATMENT_DATE_INCONSISTENT', label: 'Treatment date is consistent with medical record date', passed: false, confidence: null },
      { code: 'INVOICE_DATE_INCONSISTENT', label: 'Invoice date(s) are consistent with medical record date', passed: true, confidence: 1 },
    ] })).toEqual([
      'Medical report present (AI confidence 0.5)',
      'Invoice date(s) are consistent with medical record date (AI confidence 1)',
      'Treatment date is consistent with medical record date (could not read clearly)',
    ]);
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
    expect(await documentChecking.releaseMissingDocumentsEmail(held, 'Ops (ops1)', 'Checked page 3')).toBe(true);
    // SYSTEM_4 E4-11: what the person checked is kept in the case history.
    expect(require('../db/models').CaseEvent.create.mock.calls[0][0].message).toBe('Missing-documents email sent to the customer by Ops (ops1) after review — comment: Checked page 3');
    expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'INCOMPLETE' }, expect.objectContaining({ where: { id: 'case-1', currentStatus: 'DOCUMENTS_REVIEW' } }));
    expect(taskTypes()).toEqual(['MISSING_DOCUMENTS']);

    Case.update.mockResolvedValueOnce([0]); // moved meanwhile
    expect(await documentChecking.releaseMissingDocumentsEmail(held, 'Ops (ops1)')).toBe(false);
  });
});

it('the team email says the customer has not been emailed and what to check', () => {
  const email = render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', issues: ['No medical report'], held: ['Medical report present (AI confidence 0.3)'] });
  expect(email.subject).toBe('(ULINK AI) Check before the customer is asked — Case c1 — 1 missing');
  expect(email.bodyText).toContain('ACTION NEEDED — the customer has NOT been asked yet. The case waits for you: Medical report present (AI confidence 0.3).');
  expect(email.bodyText).toContain('If they are missing, send the customer the request below.');
  // API customer email off: ULINK emails the customer.
  const off = render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', claimNo: '2610080002', issues: ['No medical report'], held: ['a person corrected items on this case and sends the request'], contactCustomer: true });
  expect(off.subject).toBe('(ULINK AI) Check before the customer is asked — Claim 2610080002 — 1 missing');
  expect(off.bodyText).toContain('If they are missing, continue on the case page; ULINK emails the customer (the customer email is off).');
});

it('switches accept only known keys and true/false, saved with the rest of the form', async () => {
  await setSettings({ stpBlockOnReviewPoints: true }, 'admin', { transaction: 'tx' });
  expect(Setting.upsert).toHaveBeenCalledWith({ key: 'stpBlockOnReviewPoints', value: true, updatedBy: 'admin' }, { transaction: 'tx' });
  // Same messages as the STP settings form (one check for both, settingError — SYSTEM_4 phase A).
  await expect(setSettings({ somethingElse: true })).rejects.toThrow('Unknown switch somethingElse.');
  await expect(setSettings({ stpBlockOnReviewPoints: 'yes' })).rejects.toThrow('must be on or off');
});
