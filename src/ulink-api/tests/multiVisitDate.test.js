// A claim with two visits (UAT AYA-CL-26041363): doctor's notes on 24 and 26 Sep, a consultation voucher on each. The
// medical record is the 24 Sep note; the 26 Sep voucher matches the 26 Sep note, so it is not a date mismatch. An old
// visit's note (more than 30 days from the medical record) does not clear an old voucher.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');

const note = (page, date, confidence = 0.9) => ({ page: `VSQAK14067.pdf - page ${page}`, kind: 'consultation_note', date, confidence });
const fields = (secondDate, notes) => ({
  claim: { appointment_date: '2026-09-24', total_claim_amount: 64000 },
  medical: { detail_of_illness_injury: 'Fever', hospital_or_clinic_name: 'Aung Thit Sar Hospital' },
  medical_record: { present: true, legible: true, date: '2026-09-24' },
  invoices: { present: true, items: [
    { subtotal: 32000, date: '2026-09-24', voucher_type: 'consultation', legible: true, has_clinic_stamp_or_doctor_signature: true },
    { subtotal: 32000, date: secondDate, voucher_type: 'consultation', legible: true, has_clinic_stamp_or_doctor_signature: true },
  ] },
  bank: { bank_name: 'KBZ', bank_account_name: 'a', bank_account_number: '1' },
  document_list: notes,
});
const dateLine = (f) => evaluateDocumentChecks(f).checklist.find((i) => i.code === 'INVOICE_DATE_INCONSISTENT');

beforeEach(async () => { await getSettings(); });

it("a voucher dated on another doctor's note passes, naming that note's pages", () => {
  const line = dateLine(fields('2026-09-26', [note(4, '2026-09-24'), note(6, '2026-09-26'), note(17, '2026-09-26')]));
  expect(line).toMatchObject({ passed: true, confidence: 1, note: "Voucher 2 date (2026-09-26) matches the doctor's note on page 6, 17." });
});

it('a voucher with no doctor\'s note on its date still fails, listing the notes found', () => {
  const line = dateLine(fields('2026-09-28', [note(4, '2026-09-24'), note(6, '2026-09-26')]));
  expect(line.passed).toBe(false);
  expect(line.note).toBe("Voucher 2 date (2026-09-28) differs from Medical record date (2026-09-24) by 4 day(s). Doctor's notes found: 2026-09-24 (page 4), 2026-09-26 (page 6).");
});

it("an old visit's note, or a note the AI was unsure of, does not clear the voucher", () => {
  expect(dateLine(fields('2024-07-19', [note(4, '2026-09-24'), note(8, '2024-07-19')])).passed).toBe(false);
  expect(dateLine(fields('2026-09-26', [note(4, '2026-09-24'), note(6, '2026-09-26', 0.5)])).passed).toBe(false);
});
