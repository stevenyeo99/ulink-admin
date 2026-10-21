// Per-item correction (SYSTEM_4 E4-12, E4-15 step 1): a reviewer corrects one value the AI read or one check's verdict;
// the correction is stored for learning (ulink_ai_feedback), written into the case's fields, and the case is checked
// again (several corrections: saved together, one check). Models are mocked.

jest.mock('../db/models', () => ({
  sequelize: { transaction: jest.fn(async (fn) => fn('tx')) },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(async () => []), create: jest.fn() },
  AiFeedback: { create: jest.fn(async (row) => ({ id: 'f1', createdAt: new Date('2026-10-15T08:00:00Z'), ...row })), findOne: jest.fn(), findAll: jest.fn(async () => []) },
  Setting: { findAll: jest.fn(async () => []) },
}));

const fs = require('fs');
const path = require('path');
const { Case, CaseEvent, ApiCaseStep, AiFeedback } = require('../db/models');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');
const { correctionOptions, validateCorrection, aiOriginal, applyCorrection, applyVerdicts, recheckFrom, correctionHold } = require('../modules/ai-feedback/corrections');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { createCorrection, createCorrections, trustCorrection } = require('../controllers/cases/correctionsController');

const fields = () => ({
  claimant: { claimant_name: 'Hsu Myat Pyae', claimant_nrc_passport: '12/DAGAYA(N)08144', claimant_dob: '1999-12-07' },
  claim: { appointment_date: '2026-08-14', total_claim_amount: 32500 },
  medical: { detail_of_illness_injury: 'Fever' },
  medical_record: { present: true, legible: true, date: '2026-08-14' },
  invoices: { present: true, items: [{ date: '2026-08-17', subtotal: 32500, legible: true, has_clinic_stamp_or_doctor_signature: false,
    evidence: { confidence: 0.5, reason: 'handwritten 4 or 7', page: 'claim.pdf - page 3' } }] },
  bank: { bank_name: 'KBZ', bank_account_name: 'Hsu Myat Pyae', bank_account_number: '123' },
  field_evidence: [{ field: 'claimant.claimant_nrc_passport', confidence: 0.55, reason: 'last digit faint', page: 'claim.pdf - page 1' }],
});
const correction = (over) => ({ id: 'f1', reason: 'checked the receipt', wrongStep: 'reading', page: null, by: 'Ulink (ulink)', at: '2026-10-15', ...over });
const correct = (f, body, check = evaluateDocumentChecks(f)) => {
  const checked = validateCorrection({ reason: 'checked the receipt', wrongStep: 'reading', ...body }, correctionOptions(f, check));
  if (checked.error) throw new Error(checked.error);
  return applyCorrection(f, correction({ kind: checked.option.kind, item: checked.option.item, label: checked.option.label,
    corrected: checked.corrected, ...aiOriginal(f, checked.option, check) }));
};

beforeEach(() => jest.clearAllMocks());

it('the model lists match the table constraints', () => {
  // The latest migration that sets each constraint (kind: E5b added 'confirm'; wrong_step: the two exception answers).
  const read = (file) => fs.readFileSync(path.join(__dirname, `../db/migrations/${file}`), 'utf8');
  const latest = (name) => [read('20261020110000-ai-feedback-exception-steps.js'), read('20261015140000-ai-feedback-confirm.js'), read('20261015120000-create-ai-feedback.js')]
    .map((m) => m.match(new RegExp(`${name} CHECK \\(\\w+ IN \\(([^)]*)\\)`))).find(Boolean)[1];
  const constraint = (name) => latest(name).split(',').map((v) => v.trim().replace(/'/g, ''));
  const model = require('../db/models/aiFeedback')({ define: () => ({}) }, new Proxy({}, { get: () => () => ({}) }));
  expect(constraint('ulink_ai_feedback_kind_check')).toEqual(model.KINDS);
  expect(constraint('ulink_ai_feedback_wrong_step_check')).toEqual(model.WRONG_STEPS);
});

describe('what can be corrected', () => {
  it('offers the key values, each voucher\'s amount and date, and the checklist verdicts', () => {
    const options = correctionOptions(fields(), evaluateDocumentChecks(fields()));
    expect(options.find((o) => o.item === 'claimant.claimant_nrc_passport')).toMatchObject({ kind: 'value', type: 'text', current: '12/DAGAYA(N)08144' });
    expect(options.find((o) => o.item === 'invoices.items.0.date')).toMatchObject({ type: 'date', current: '2026-08-17' });
    expect(options.find((o) => o.item === 'INCORRECT_VOUCHER')).toMatchObject({ kind: 'verdict', current: false, canFail: true });
    expect(options.some((o) => o.item === 'MISSING_MANDATORY_FIELD')).toBe(false);
  });

  it('refuses a correction without a reason, a step, a valid value, or a change', () => {
    const options = correctionOptions(fields(), evaluateDocumentChecks(fields()));
    const ok = { kind: 'value', item: 'claim.total_claim_amount', value: '35,000', reason: 'receipt says 35,000', wrongStep: 'reading' };
    expect(validateCorrection(ok, options)).toMatchObject({ corrected: 35000 });
    expect(validateCorrection({ ...ok, reason: '' }, options).error).toMatch('comment');
    expect(validateCorrection({ ...ok, wrongStep: 'guess' }, options).error).toMatch('what went wrong');
    expect(validateCorrection({ ...ok, value: 'abc' }, options).error).toMatch('enter an amount');
    expect(validateCorrection({ ...ok, value: 32500 }, options).error).toMatch('already');
    expect(validateCorrection({ ...ok, item: 'invoices.items.0.date', value: '2026-02-30' }, options).error).toMatch('YYYY-MM-DD');
    expect(validateCorrection({ ...ok, item: 'claimant.phone_number' }, options).error).toMatch('can be corrected');
    expect(validateCorrection({ kind: 'verdict', item: 'INCORRECT_VOUCHER', passed: false, reason: 'x x', wrongStep: 'check' }, options).error).toMatch('already fails');
  });
});

describe('a correction in force', () => {
  it('a corrected invoice date lets the document check pass (PRD acceptance); the AI value and confidence are kept', () => {
    const before = evaluateDocumentChecks(fields());
    expect(before.checklist.find((l) => l.code === 'INVOICE_DATE_INCONSISTENT').passed).toBe(false);

    const after = correct(fields(), { kind: 'value', item: 'invoices.items.0.date', value: '2026-08-14' });
    expect(after.invoices.items[0]).toMatchObject({ date: '2026-08-14', evidence: { confidence: 0.5, page: 'claim.pdf - page 3', corrected: ['date'] } });
    expect(after.invoices.items[0].evidence.reason).toContain('date corrected by Ulink (ulink): checked the receipt');
    expect(after.corrections).toEqual([expect.objectContaining({ item: 'invoices.items.0.date', aiValue: '2026-08-17', aiConfidence: 0.5, corrected: '2026-08-14' })]);
    expect(evaluateDocumentChecks(after).checklist.find((l) => l.code === 'INVOICE_DATE_INCONSISTENT').passed).toBe(true);
  });

  it('a second correction of the same item keeps the AI\'s value, not the first person\'s', () => {
    const once = correct(fields(), { kind: 'value', item: 'claimant.claimant_nrc_passport', value: '12/DAGAYA(N)081441' });
    const twice = correct(once, { kind: 'value', item: 'claimant.claimant_nrc_passport', value: '12/DAGAYA(N)081447' });
    expect(twice.corrections).toHaveLength(1);
    expect(twice.corrections[0]).toMatchObject({ aiValue: '12/DAGAYA(N)08144', aiConfidence: 0.55, corrected: '12/DAGAYA(N)081447', page: 'claim.pdf - page 1' });
    expect(twice.field_evidence.filter((e) => e.field === 'claimant.claimant_nrc_passport')).toEqual([expect.objectContaining({ confidence: 1 })]);
  });

  it('a check set to pass drops its customer wording; set to fail adds it', () => {
    const f = fields();
    const result = evaluateDocumentChecks(f);
    expect(result.issues).toContain('Incorrect voucher(s)');
    const passed = applyVerdicts(result, [correction({ kind: 'verdict', item: 'INCORRECT_VOUCHER', label: 'x', aiValue: false, corrected: true })]);
    expect(passed.issues).not.toContain('Incorrect voucher(s)');
    expect(passed.details.some((d) => d.code === 'INCORRECT_VOUCHER')).toBe(false);
    expect(passed.checklist.find((l) => l.code === 'INCORRECT_VOUCHER')).toMatchObject({ passed: true, confidence: 1, corrected: { aiPassed: false } });

    const failed = applyVerdicts(result, [correction({ kind: 'verdict', item: 'MISSING_BANK_INFO', label: 'x', aiValue: true, corrected: false })]);
    expect(failed.issues).toContain('Missing bank information');
    expect(failed.passed).toBe(false);

    // The AI was right and a person let it pass anyway: the note says "accepted", not "corrected".
    const accepted = applyVerdicts(result, [correction({ kind: 'verdict', item: 'INCORRECT_VOUCHER', label: 'x', aiValue: false, corrected: true, wrongStep: 'exception', reason: 'AI was right' })]);
    expect(accepted.checklist.find((l) => l.code === 'INCORRECT_VOUCHER').note)
      .toBe('Passed — accepted by Ulink (ulink) (the AI was right, accepted as an exception): AI was right (the AI said failed).');
  });

  it('the summary (case page, team emails, IAS remark) shows AI value → corrected value, who and why', () => {
    const after = correct(fields(), { kind: 'value', item: 'claimant.claimant_nrc_passport', value: '12/DAGAYA(N)081441' });
    const line = buildAssessmentSummary({ extractedFields: after }).lines.find((l) => l.decision === 'Corrected by a person');
    expect(line.why).toBe('NRC / passport: AI "12/DAGAYA(N)08144" → "12/DAGAYA(N)081441" (corrected by Ulink (ulink) — the page was misread: checked the receipt).');
    expect(line.review).toBeNull();
  });
});

describe('POST /api/cases/:id/corrections', () => {
  const user = { username: 'ulink', name: 'Ulink', role: 'super_admin' };
  const send = async (handler, req) => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await handler({ user, params: { id: 'c1' }, ...req }, res);
    return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
  };
  const emailCase = (over = {}) => {
    const row = { id: 'c1', source: 'EMAIL', currentStatus: 'INCOMPLETE', extractedFields: fields(), documentCheckResult: evaluateDocumentChecks(fields()), ...over };
    return { ...row, toJSON: () => row };
  };
  const body = { kind: 'value', item: 'invoices.items.0.date', value: '2026-08-14', reason: 'receipt shows the 14th', wrongStep: 'reading' };

  it('email case: stores it, writes the corrected fields, sends the case back to the document check', async () => {
    Case.findByPk.mockResolvedValue(emailCase());
    const { status } = await send(createCorrection, { body });
    expect(status).toBe(200);
    expect(AiFeedback.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'value', aiValue: '2026-08-17', correctedValue: '2026-08-14', wrongStep: 'reading', createdBy: 'ulink' }), expect.anything());
    const [update, where] = Case.update.mock.calls[0];
    expect(update.currentStatus).toBe('READY_FOR_DOCUMENT_CHECKING'); // a voucher date: not a member-check value
    expect(update.extractedFields.invoices.items[0].date).toBe('2026-08-14');
    expect(where.where).toEqual({ id: 'c1', currentStatus: 'INCOMPLETE' });
    expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'MANUAL_CORRECTION', newStatus: 'INCOMPLETE', message: expect.stringContaining('AI "2026-08-17" → "2026-08-14"') }), expect.anything());
  });

  it('API case: a new recognition step with the corrected fields; the AI\'s step is untouched', async () => {
    const aiStep = { job: 'api-claim-recognition', status: 'DONE', createdAt: 1, output: { recognizedType: 'ayas_member_claim', extractedFields: fields() } };
    const checkStep = { job: 'api-document-checking', status: 'DONE', createdAt: 2, output: { documentCheckResult: evaluateDocumentChecks(fields()) } };
    ApiCaseStep.findAll.mockResolvedValue([aiStep, checkStep]);
    Case.findByPk.mockResolvedValue(emailCase({ source: 'API', currentStatus: 'API_DOCUMENTS_REVIEW', extractedFields: null }));
    const { status } = await send(createCorrection, { body });
    expect(status).toBe(200);
    expect(Case.update.mock.calls[0][0]).toEqual({ currentStatus: 'API_READY_FOR_DOCUMENT_CHECKING' });
    const step = ApiCaseStep.create.mock.calls[0][0];
    expect(step).toMatchObject({ job: 'api-claim-recognition', status: 'DONE', output: { recognizedType: 'ayas_member_claim' } });
    expect(step.output.extractedFields.invoices.items[0].date).toBe('2026-08-14');
    expect(aiStep.output.extractedFields.invoices.items[0].date).toBe('2026-08-17');
  });

  it('refuses a case not held by a finding, an invalid correction, and a case that moved meanwhile', async () => {
    Case.findByPk.mockResolvedValue(emailCase({ currentStatus: 'CLAIM_CREATED' }));
    expect((await send(createCorrection, { body })).status).toBe(400);

    Case.findByPk.mockResolvedValue(emailCase());
    expect((await send(createCorrection, { body: { ...body, reason: '' } })).status).toBe(400);

    Case.update.mockResolvedValueOnce([0]);
    expect((await send(createCorrection, { body })).status).toBe(409);
    expect(CaseEvent.create).not.toHaveBeenCalled();
  });

  it('Save all: every change saved together and the case checked once; one bad change saves nothing', async () => {
    const date = { kind: 'value', item: 'invoices.items.0.date', value: '2026-08-14', reason: 'receipt shows the 14th', wrongStep: 'reading' };
    const nrc = { kind: 'value', item: 'claimant.claimant_nrc_passport', value: '12/DAGAYA(N)081441', reason: 'last digit is 1', wrongStep: 'reading' };

    Case.findByPk.mockResolvedValue(emailCase());
    const { status, body: res1 } = await send(createCorrections, { body: { items: [date] } });
    expect(status).toBe(200);
    expect(res1.currentStatus).toBe('READY_FOR_DOCUMENT_CHECKING');
    expect(Case.update).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    const { body: res2 } = await send(createCorrections, { body: { items: [date, nrc] } });
    expect(res2.currentStatus).toBe('RECOGNIZED'); // the NRC is a member-check value
    expect(AiFeedback.create).toHaveBeenCalledTimes(2);
    const [update] = Case.update.mock.calls[0];
    expect(update.extractedFields.invoices.items[0].date).toBe('2026-08-14');
    expect(update.extractedFields.claimant.claimant_nrc_passport).toBe('12/DAGAYA(N)081441');
    expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'MANUAL_RECHECK', message: expect.stringContaining('2 correction(s)') }), expect.anything());

    jest.clearAllMocks();
    const bad = await send(createCorrections, { body: { items: [date, { ...nrc, reason: '' }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/^NRC/); // named by what was changed, not a position
    expect(AiFeedback.create).not.toHaveBeenCalled();
    expect(Case.update).not.toHaveBeenCalled();
    expect((await send(createCorrections, { body: { items: [date, date] } })).status).toBe(400);
  });

  it('trusted only by a different person', async () => {
    const row = { id: 'f1', caseId: 'c1', createdBy: 'ulink', trusted: false, update: jest.fn() };
    AiFeedback.findOne.mockResolvedValue(row);
    expect((await send(trustCorrection, { params: { id: 'c1', feedbackId: 'f1' } })).status).toBe(403);

    const other = await new Promise((resolve) => {
      const res = { status: jest.fn(() => res), json: (b) => resolve({ status: res.status.mock.calls[0]?.[0] ?? 200, body: b }) };
      trustCorrection({ user: { username: 'jd3' }, params: { id: 'c1', feedbackId: 'f1' } }, res);
    });
    expect(other.status).toBe(200);
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ trusted: true, trustedBy: 'jd3' }));
  });
});

describe('code review 2026-10-15', () => {
  it('re-checks from the member check only for a value it compares with IAS, or a case held there', () => {
    expect(recheckFrom('claimant.claimant_nrc_passport', 'INCOMPLETE')).toMatchObject({ EMAIL: 'RECOGNIZED', API: 'API_RECOGNIZED' });
    expect(recheckFrom('bank.bank_account_number', 'API_DOCUMENTS_REVIEW')).toMatchObject({ API: 'API_RECOGNIZED' });
    expect(recheckFrom('invoices.items.0.subtotal', 'INCOMPLETE')).toMatchObject({ EMAIL: 'READY_FOR_DOCUMENT_CHECKING' });
    expect(recheckFrom('INCORRECT_VOUCHER', 'API_DOCUMENTS_UNSURE')).toMatchObject({ API: 'API_READY_FOR_DOCUMENT_CHECKING' });
    expect(recheckFrom('INCORRECT_VOUCHER', 'MEMBER_REVIEW_REQUIRED')).toMatchObject({ EMAIL: 'RECOGNIZED' });
  });

  it('a voucher is sure only once both its amount and date are corrected', () => {
    const date = correct(fields(), { kind: 'value', item: 'invoices.items.0.date', value: '2026-08-14' });
    expect(date.invoices.items[0].evidence.confidence).toBe(0.5);
    const both = correct(date, { kind: 'value', item: 'invoices.items.0.subtotal', value: '33000' });
    expect(both.invoices.items[0].evidence).toMatchObject({ confidence: 1, corrected: ['date', 'subtotal'] });
  });

  it('a refund voucher amount may be corrected to a negative number; the claimed amount may not', () => {
    const options = correctionOptions(fields(), evaluateDocumentChecks(fields()));
    const base = { reason: 'refund slip', wrongStep: 'reading' };
    expect(validateCorrection({ ...base, kind: 'value', item: 'invoices.items.0.subtotal', value: '-5000' }, options)).toMatchObject({ corrected: -5000 });
    expect(validateCorrection({ ...base, kind: 'value', item: 'claim.total_claim_amount', value: '-5000' }, options).error).toMatch('above zero');
  });

  it('a check set to pass removes only its own issue — wording another line still raises stays', () => {
    const shared = 'Please fill in the attached delegation letter to proceed with the payment process';
    const result = {
      passed: false, issues: [shared], flags: [],
      details: [{ issue: shared, code: 'DELEGATION_LETTER_REQUIRED' }, { issue: shared, code: 'DELEGATION_PAYEE_INCONSISTENT' }],
      checklist: [{ code: 'DELEGATION_LETTER_REQUIRED', passed: false }, { code: 'DELEGATION_PAYEE_INCONSISTENT', passed: false }],
    };
    const after = applyVerdicts(result, [correction({ kind: 'verdict', item: 'DELEGATION_LETTER_REQUIRED', label: 'x', aiValue: false, corrected: true })]);
    expect(after.issues).toEqual([shared]);
    expect(after.passed).toBe(false);
  });

  it('missing documents found after a correction are held for the person, never emailed by themselves', () => {
    const failed = { passed: false, issues: ['Missing voucher(s)'] };
    expect(correctionHold(failed, { corrections: [{ id: 'f1' }] })).toHaveLength(1);
    expect(correctionHold(failed, {})).toEqual([]);
    expect(correctionHold({ passed: true, issues: [] }, { corrections: [{ id: 'f1' }] })).toEqual([]);
  });
});

describe('POST /api/cases/:id/confirmations — "✓ Right" (E5b)', () => {
  const { createConfirmation } = require('../controllers/cases/correctionsController');
  const user = { username: 'ulink', name: 'Ulink', role: 'super_admin' };
  const send = async (body, caseRow) => {
    Case.findByPk.mockResolvedValue({ ...caseRow, toJSON: () => caseRow });
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await createConfirmation({ user, params: { id: 'c1' }, body }, res);
    return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
  };
  const row = (over = {}) => ({ id: 'c1', source: 'EMAIL', currentStatus: 'CLAIM_CREATED', extractedFields: fields(), documentCheckResult: evaluateDocumentChecks(fields()), ...over });

  it('records the value, the AI\'s confidence and page — and changes nothing on the case, even a decided one', async () => {
    AiFeedback.findAll.mockResolvedValue([]);
    const { status } = await send({ kind: 'value', item: 'claimant.claimant_nrc_passport' }, row());
    expect(status).toBe(200);
    expect(AiFeedback.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'confirm', item: 'claimant.claimant_nrc_passport', aiValue: '12/DAGAYA(N)08144', correctedValue: '12/DAGAYA(N)08144',
      aiConfidence: 0.55, page: 'claim.pdf - page 1', wrongStep: null, reason: 'Checked against the document', createdBy: 'ulink',
    }));
    expect(Case.update).not.toHaveBeenCalled();
    expect(CaseEvent.create).not.toHaveBeenCalled();
  });

  it('a verdict too; a second click is the same answer, not a new row', async () => {
    AiFeedback.findAll.mockResolvedValue([{ id: 'f8', correctedValue: false }, { id: 'f9', correctedValue: true }]);
    const { body } = await send({ kind: 'verdict', item: 'MISSING_BANK_INFO' }, row());
    expect(body.confirmation.id).toBe('f9');
    expect(AiFeedback.create).not.toHaveBeenCalled();
  });

  it('refuses an item not on the case, or a value the AI never read', async () => {
    AiFeedback.findAll.mockResolvedValue([]);
    expect((await send({ kind: 'value', item: 'claimant.phone_number' }, row())).status).toBe(400);
    expect((await send({ kind: 'value', item: 'policy.policy_no' }, row())).status).toBe(400); // not read
  });

  it('refuses a value a person corrected (that is "Mark trusted"), and trusting a confirmation', async () => {
    AiFeedback.findAll.mockResolvedValue([]);
    const corrected = { ...fields(), corrections: [{ item: 'claimant.claimant_nrc_passport', kind: 'value' }] };
    const { status, body } = await send({ kind: 'value', item: 'claimant.claimant_nrc_passport' }, row({ extractedFields: corrected }));
    expect(status).toBe(400);
    expect(body.error.message).toMatch('mark that correction trusted');

    AiFeedback.findOne.mockResolvedValue({ id: 'f1', caseId: 'c1', kind: 'confirm', createdBy: 'ann', update: jest.fn() });
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await trustCorrection({ user: { username: 'jd3' }, params: { id: 'c1', feedbackId: 'f1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('two clicks at once: the unique index keeps one, and both get it', async () => {
    AiFeedback.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'f7', correctedValue: '12/DAGAYA(N)08144' }]);
    AiFeedback.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
    const { status, body } = await send({ kind: 'value', item: 'claimant.claimant_nrc_passport' }, row());
    expect(status).toBe(200);
    expect(body.confirmation.id).toBe('f7');
  });
});

it('the two exception answers are for check verdicts only, and the report shows them apart from AI corrections', () => {
  const { validateCorrection } = require('../modules/ai-feedback/corrections');
  const verdict = { kind: 'verdict', item: 'HOSPITAL_NAME_INCONSISTENT', label: 'Hospital', type: 'verdict', current: false, canFail: true };
  const value = { kind: 'value', item: 'claim.total_claim_amount', label: 'Claimed amount', type: 'amount', current: 100 };
  expect(validateCorrection({ kind: 'verdict', item: verdict.item, passed: true, reason: 'IAS census not updated', wrongStep: 'ias_outdated' }, [verdict]).error).toBeUndefined();
  expect(validateCorrection({ kind: 'value', item: value.item, value: '120', reason: 'customer typed it', wrongStep: 'exception' }, [value]).error).toMatch(/not an exception/);
  const { feedbackRow } = require('../modules/ai-feedback/report');
  expect(feedbackRow({ kind: 'verdict', item: verdict.item, wrongStep: 'exception', aiValue: false, correctedValue: true }).type).toBe('Accepted as an exception (not AI)');
  expect(feedbackRow({ kind: 'verdict', item: verdict.item, wrongStep: 'check', aiValue: false, correctedValue: true }).type).toBe('Correction');
});
