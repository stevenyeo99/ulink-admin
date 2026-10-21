// "✓ Right" counts on the next document check (AYA-CL-26043766, owner 2026-10-21): a confirmed value or check result
// that is still the same is sure; a changed one is not; a failed check stays failed.
jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { withConfirmedValues, withConfirmedChecks } = require('../modules/ai-feedback/confirmations');
const { fieldsReadCheck } = require('../modules/document-checking/checklist');

const fields = () => ({
  bank: { bank_name: 'AYA', bank_account_name: 'Saw Wai Yan', bank_account_number: '20030586211' },
  field_evidence: [{ field: 'bank.bank_account_number', confidence: 0.6, page: 'claim.pdf - page 12', reason: 'Found by text search' }],
});
const confirm = (item, correctedValue) => ({ kind: 'confirm', item, correctedValue, createdBy: 'ulink' });

beforeEach(() => getSettings());

it('a confirmed value that is unchanged counts as sure, on its page', () => {
  const f = withConfirmedValues(fields(), [confirm('bank.bank_account_number', '20030586211')]);
  expect(f.field_evidence).toEqual([{ field: 'bank.bank_account_number', confidence: 1, reason: 'Confirmed by ulink against the document', page: 'claim.pdf - page 12' }]);
  expect(fieldsReadCheck(f, []).fields.find((e) => e.field === 'bank.bank_account_number').confidence).toBe(1);
});

it('a confirmation of another value does not count (the value changed since)', () => {
  const f = fields();
  expect(withConfirmedValues(f, [confirm('bank.bank_account_number', '99999999')])).toBe(f);
});

it('a confirmed passed check is sure; a failed check stays failed', () => {
  const result = { checklist: [
    { code: 'MISSING_BANK_INFO', passed: true, confidence: 0.6, note: 'Found: bank name, account holder, account number.' },
    { code: 'VOUCHER_AMOUNT_MISMATCH', passed: false, confidence: 0.9 },
  ] };
  const after = withConfirmedChecks(result, [confirm('MISSING_BANK_INFO', true), confirm('VOUCHER_AMOUNT_MISMATCH', true)]);
  expect(after.checklist[0]).toMatchObject({ passed: true, confidence: 1, note: 'Found: bank name, account holder, account number. Confirmed by ulink against the document.' });
  expect(after.checklist[1]).toEqual(result.checklist[1]);
});
