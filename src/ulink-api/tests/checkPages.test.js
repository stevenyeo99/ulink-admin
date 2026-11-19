// UAT 17/11 (owner 2026-11-19): each check names the pages it looked at, so the review page links them.
const { forCasePage } = require('../modules/document-checking/checklist');

const fields = {
  field_evidence: [{ field: 'claim.total_claim_amount', page: 'claim.pdf - page 2' }],
  invoices: { items: [
    { subtotal: 100, evidence: { page: 'claim.pdf - page 6' } },
    { subtotal: 200, has_vitamin_or_supplement: true, evidence: { page: 'claim.pdf - page 7' } },
  ] },
  medical_record: { date: '2026-08-21' },
  document_list: [{ kind: 'consultation_note', date: '2026-08-21', confidence: 0.95, page: 'claim.pdf - page 5' }],
};

test('each check gets the pages of the values and documents it looked at', () => {
  const { checklist } = forCasePage({ checklist: [
    { code: 'VOUCHER_AMOUNT_MISMATCH', passed: false },
    { code: 'INVOICE_DATE_INCONSISTENT', passed: false },
    { code: 'VITAMIN_OR_SUPPLEMENT', passed: false },
    { code: 'PROVIDER_NAME_INCONSISTENT', passed: null },
    { code: 'BENEFIT_TYPE', passed: true },
  ] }, fields);
  expect(checklist[0].pages).toEqual([
    { what: 'Claimed amount', page: 'claim.pdf - page 2' },
    { what: 'Voucher 1', page: 'claim.pdf - page 6' },
    { what: 'Voucher 2', page: 'claim.pdf - page 7' },
  ]);
  // The medical record date has no page of its own: the doctor's note of that date.
  expect(checklist[1].pages[0]).toEqual({ what: 'Medical record date', page: 'claim.pdf - page 5' });
  expect(checklist[2].pages).toEqual([{ what: 'Voucher 2', page: 'claim.pdf - page 7' }]);
  expect(checklist[3].pages).toBeUndefined(); // did not run
  expect(checklist[4].pages).toBeUndefined(); // no page source
});

// A check stored before its label followed the result shows the right label when the case opens.
test('a stored label follows the result when the case opens; the hold reason needs no "Not met:" for it', () => {
  const { unsureDocumentPoints } = require('../modules/document-checking/holdForReview');
  const { checklist } = forCasePage({ checklist: [
    { code: 'INVOICE_DATE_INCONSISTENT', label: 'Invoice date(s) are consistent with medical record date', passed: false },
    { code: 'TREATMENT_DATE_INCONSISTENT', label: 'Treatment date is consistent with medical record date', passed: true },
    { code: 'VITAMIN_OR_SUPPLEMENT', label: 'No vitamins / supplements on the vouchers', passed: false },
  ] }, null);
  expect(checklist.map((c) => c.label)).toEqual([
    'Invoice date(s) are inconsistent with medical record date',
    'Treatment date is consistent with medical record date',
    'Vitamins / supplements found on the vouchers',
  ]);
  expect(unsureDocumentPoints({ checklist })).toEqual(['Invoice date(s) are inconsistent with medical record date']);
});

// Only a decided check changes its label: an undecided or turned-off line keeps the one it was stored with.
test('an undecided or turned-off line keeps its stored label', () => {
  const { checklist } = forCasePage({ checklist: [
    { code: 'TREATMENT_DATE_INCONSISTENT', label: 'Treatment date is inconsistent with medical record date', passed: null, turnedOff: true },
    { code: 'VITAMIN_OR_SUPPLEMENT', label: 'No vitamins / supplements on the vouchers', passed: null },
  ] }, null);
  expect(checklist.map((c) => c.label)).toEqual(['Treatment date is inconsistent with medical record date', 'No vitamins / supplements on the vouchers']);
});
