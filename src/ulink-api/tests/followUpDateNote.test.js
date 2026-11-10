// A follow-up visit (UAT AYA-CL-26021418): a lab or pharmacy voucher dated after the consultation, up to 30 days later,
// gets a hint on the date check notes. Wording only: the date checks still fail and a person decides.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');

const fields = (voucher) => ({
  claim: { appointment_date: voucher.date, total_claim_amount: 36750 },
  medical: { detail_of_illness_injury: 'Overweight', hospital_or_clinic_name: 'Aryu' },
  medical_record: { present: true, legible: true, date: '2026-05-25' },
  invoices: { present: true, items: [{ subtotal: 36750, legible: true, has_clinic_stamp_or_doctor_signature: true, ...voucher }] },
  bank: { bank_name: 'KBZ', bank_account_name: 'me me win pe', bank_account_number: '12730102104946001' },
});
const dateLines = (f) => {
  const { checklist } = evaluateDocumentChecks(f);
  return ['TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT'].map((code) => checklist.find((i) => i.code === code));
};

beforeEach(async () => { await getSettings(); });

it('a lab voucher 16 days after the consultation: both date checks still fail, with the follow-up hint', () => {
  const [claim, voucher] = dateLines(fields({ date: '2026-06-10', voucher_type: 'lab' }));
  expect(claim).toMatchObject({ passed: false });
  expect(claim.note).toBe('Claim date (2026-06-10) differs from Medical record date (2026-05-25) by 16 day(s). The claim date matches voucher 1 (possible follow-up visit).');
  expect(voucher).toMatchObject({ passed: false });
  expect(voucher.note).toContain("Possible follow-up visit (lab voucher after the consultation): check the doctor's recommendation in the medical record.");
});

it('no hint for a consultation or "other" voucher, a voucher before the consultation, or one over 30 days later', () => {
  for (const voucher of [
    { date: '2026-06-10', voucher_type: 'consultation' },
    { date: '2026-06-10', voucher_type: 'other' },
    { date: '2026-05-20', voucher_type: 'lab' },
    { date: '2026-07-04', voucher_type: 'pharmacy' },
  ]) {
    for (const line of dateLines(fields(voucher))) {
      expect(line.passed).toBe(false);
      expect(line.note).not.toMatch(/follow-up/);
    }
  }
});
