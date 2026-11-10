// "Missing detailed breakdown for pharmacy charges" (UAT AYA-CL-26035164): a pharmacy voucher whose printed lines the AI
// added up (line_total) has a breakdown, even when the AI marked it as not itemized.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');

const fields = (pharmacy) => ({
  claim: { appointment_date: '2026-08-12', total_claim_amount: 28700 },
  medical: { detail_of_illness_injury: 'Fever', hospital_or_clinic_name: 'Mudetar Medical Centre' },
  medical_record: { present: true, legible: true, date: '2026-08-12' },
  invoices: { present: true, items: [
    { date: '2026-08-12', subtotal: 21500, voucher_type: 'consultation', legible: true, has_itemized_breakdown: true, has_clinic_stamp_or_doctor_signature: true },
    { date: '2026-08-12', subtotal: 7200, voucher_type: 'pharmacy', legible: true, has_clinic_stamp_or_doctor_signature: true, ...pharmacy },
  ] },
  bank: { bank_name: 'AYA', bank_account_name: 'Saw Wai Lyan', bank_account_number: '20030586211' },
});
const breakdown = (f) => {
  const result = evaluateDocumentChecks(f);
  return { line: result.checklist.find((i) => i.code === 'MISSING_VOUCHER_BREAKDOWN'), details: result.details };
};

beforeEach(async () => { await getSettings(); });

it('passes a pharmacy voucher the AI marked not itemized when it added up its printed lines', () => {
  expect(breakdown(fields({ has_itemized_breakdown: false, line_total: 7200 })).line.passed).toBe(true);
});

it('still fails when both readings agree there are no line amounts, and names the voucher', () => {
  const { line, details } = breakdown(fields({ has_itemized_breakdown: false, line_total: null }));
  expect(line.passed).toBe(false);
  expect(details.find((d) => d.code === 'MISSING_VOUCHER_BREAKDOWN').reason).toContain('Pharmacy voucher(s) #2 do not list');
});
