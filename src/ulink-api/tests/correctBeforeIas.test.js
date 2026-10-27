// Correctness before the claim goes (again) to IAS (owner, 2026-10-19 — AYA-CL-26043792: the AI read the voucher as
// 198,000, the receipt says 190,000, and the claim was suspended for an amount mismatch):
//   - a value can be corrected while the case waits for the customer (API: revised with suspense; email: INCOMPLETE);
//   - a voucher amount a person corrected is not compared with the AI's own recount of the lines any more;
//   - the voucher type (read by claim preparation for the IAS benefit) can be corrected, from a fixed list.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { CORRECTABLE_STATUSES } = require('../controllers/cases/correctionsController');
const { correctionOptions, validateCorrection, applyCorrection, recheckFrom } = require('../modules/ai-feedback/corrections');
const { formatCheck, evaluateDocumentChecks, withEditItems } = require('../modules/document-checking/checklist');

const fields = () => ({
  claim: { total_claim_amount: 190000, appointment_date: '2026-10-08', type_of_patient: 'optical care' },
  invoices: { items: [{ subtotal: 198000, line_total: 198000, date: '2026-10-08', voucher_type: 'consultation', evidence: { confidence: 0.95, page: 'B.pdf - page 6' } }] },
});
const correct = (f, option, value) => applyCorrection(f, { kind: 'value', item: option.item, label: option.label, corrected: value, reason: 'The receipt shows 190,000', by: 'Ulink (ulink)', wrongStep: 'reading' });

beforeEach(() => getSettings()); // formatCheck reads the voucher-date limit from the settings

it('corrections are allowed while the case waits for the customer, never on a finished case', () => {
  expect(CORRECTABLE_STATUSES).toEqual(expect.arrayContaining(['API_CLAIM_SUSPENDED', 'INCOMPLETE', 'API_MEMBER_REVIEW_REQUIRED', 'API_DOCUMENTS_REVIEW']));
  for (const done of ['API_CLAIM_REVISED', 'API_CSR_SENT', 'CLAIM_CREATED', 'CSR_SENT']) expect(CORRECTABLE_STATUSES).not.toContain(done);
  // A voucher amount: the member balance uses it (SYSTEM_5 member balance phase C), so from the member check.
  expect(recheckFrom('invoices.items.0.subtotal', 'API_CLAIM_SUSPENDED').API).toBe('API_RECOGNIZED');
});

it("a corrected voucher amount is not compared with the AI's recount (no false review point)", () => {
  expect(formatCheck(correct(fields(), { item: 'invoices.items.0.subtotal', label: 'Voucher 1 amount' }, 190000)).problems)
    .not.toEqual(expect.arrayContaining([expect.stringContaining('lines add up')]));
  const misread = { ...fields(), invoices: { items: [{ ...fields().invoices.items[0], subtotal: 190000 }] } };
  expect(formatCheck(misread).problems).toEqual(expect.arrayContaining([expect.stringContaining('lines add up to 198,000')]));
});

it('the voucher type is corrected from a fixed list, and claim preparation then reads it', () => {
  const options = correctionOptions(fields());
  const type = options.find((o) => o.item === 'invoices.items.0.voucher_type');
  expect(type).toMatchObject({ type: 'choice', current: 'consultation', choices: ['consultation', 'pharmacy', 'lab', 'optical', 'other'] });
  expect(validateCorrection({ kind: 'value', item: type.item, value: 'optical', reason: 'an optical shop receipt', wrongStep: 'reading' }, options).corrected).toBe('optical');
  expect(validateCorrection({ kind: 'value', item: type.item, value: 'glasses', reason: 'checked against page 3', wrongStep: 'reading' }, options).error).toMatch(/choose one of/);
  expect(correct(fields(), type, 'optical').invoices.items[0].voucher_type).toBe('optical');
  // Not the type of patient: free text ("optical care") the member check compares with IAS as written.
  expect(options.some((o) => o.item === 'claim.type_of_patient')).toBe(false);
});

it('a failed amount check names the values it compared, so each can be edited on its line (old results too)', () => {
  const f = { ...fields(), medical: { detail_of_illness_injury: 'Glasses' }, medical_record: { present: true }, bank: { bank_name: 'AYA' } };
  f.invoices.present = true;
  const line = evaluateDocumentChecks(f).checklist.find((l) => l.code === 'VOUCHER_AMOUNT_MISMATCH');
  expect(line).toMatchObject({ passed: false, editItems: ['claim.total_claim_amount', 'invoices.items.0.subtotal'] });
  const stored = { checklist: [{ code: 'VOUCHER_AMOUNT_MISMATCH', passed: false }] };
  expect(withEditItems(stored, f).checklist[0].editItems).toEqual(['claim.total_claim_amount', 'invoices.items.0.subtotal']);
});

it('the values check names the value behind each problem, so the review page can offer ✎ Edit and ✓ Right on it', () => {
  // AYA-CL-26043392: voucher 1 read as 2025-10-08 for a 2026-10-08 visit.
  const yearOff = { ...fields(), invoices: { items: [{ ...fields().invoices.items[0], subtotal: 190000, line_total: 190000, date: '2025-10-08' }] } };
  const check = formatCheck(yearOff, '2026-10-21');
  expect(check).toMatchObject({ confidence: 0, editItems: ['invoices.items.0.date'], usedFields: ['voucher 1'] });
  expect(correctionOptions(yearOff).some((o) => o.item === 'invoices.items.0.date')).toBe(true);
  // A result stored before the check named its values gets them on load.
  const { editItems: _e, usedFields: _u, ...stored } = check;
  expect(withEditItems({ checklist: [stored] }, yearOff).checklist[0].editItems).toEqual(['invoices.items.0.date']);
  // No problem: nothing to edit.
  expect(formatCheck({ ...yearOff, invoices: { items: [{ ...yearOff.invoices.items[0], date: '2026-10-08' }] } }, '2026-10-21').editItems).toBeUndefined();
});

it('a missing mandatory field a person can correct names its value, so the review page offers ✎ Edit (AYA-CL-26043766)', () => {
  // The AI read the account number as "unclear" on page 2; page 12 shows it.
  const noAccount = {
    claimant: { claimant_name: 'Saw Wai Yan' },
    claim: { appointment_date: '2026-10-02', total_claim_amount: 110000 },
    medical: { detail_of_illness_injury: 'Toothache', hospital_or_clinic_name: 'LiSac Dental Clinic' },
    medical_record: { present: true, legible: true, date: '2026-10-02' },
    invoices: { present: true, items: [{ date: '2026-10-02', subtotal: 110000, legible: true, has_clinic_stamp_or_doctor_signature: true, voucher_type: 'consultation' }] },
    bank: { bank_name: 'AYA', bank_account_name: 'Saw Wai Yan', bank_account_number: null },
  };
  const lines = evaluateDocumentChecks(noAccount).checklist.filter((l) => l.code === 'MISSING_MANDATORY_FIELD');
  expect(lines.find((l) => l.label === 'Bank Information: Account Number')).toMatchObject({ passed: false, editItems: ['bank.bank_account_number'] });
  expect(lines.find((l) => l.label === 'Bank Information: Bank Name').editItems).toBeUndefined(); // found: nothing to edit
  expect(correctionOptions(noAccount).some((o) => o.item === 'bank.bank_account_number')).toBe(true);
  // A result stored before the line named its value gets it on load.
  const stored = { checklist: [{ code: 'MISSING_MANDATORY_FIELD', label: 'Bank Information: Account Number', passed: false }] };
  expect(withEditItems(stored, noAccount).checklist[0].editItems).toEqual(['bank.bank_account_number']);
});
