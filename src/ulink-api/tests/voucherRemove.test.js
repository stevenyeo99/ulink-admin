// Remove a voucher that is not part of the claim, and put it back (UAT 17/11, owner 2026-11-19, plan
// docs/imp/UAT/20261119_review_fixes_and_remove_voucher_plan.md): the voucher leaves invoices.items, is kept in
// invoices.removed with who and why, and IAS gets nothing for it. No database.
const { correctionOptions, validateCorrection, applyCorrection, recheckFrom } = require('../modules/ai-feedback/corrections');

const fields = () => ({
  invoices: { items: [
    { subtotal: 36750, date: '2026-06-10', voucher_type: 'lab' },
    { subtotal: 218915, date: '2026-06-10', voucher_type: 'other' },
    { subtotal: 5000, date: '2026-06-11', voucher_type: 'pharmacy' },
  ] },
  corrections: [
    { item: 'invoices.items.1.date', corrected: '2026-06-10', by: 'a' },
    { item: 'invoices.items.2.subtotal', corrected: 5000, by: 'a' },
    { item: 'claim.total_claim_amount', corrected: 36750, by: 'a' },
  ],
});
const correction = (item) => ({ id: 'r1', kind: 'value', item, corrected: true, reason: 'Not part of this claim.', by: 'ulink', at: 'now' });

it('offers Remove on each voucher while another stays, and checks again from the member check', () => {
  const options = correctionOptions(fields());
  expect(options.filter((o) => o.type === 'remove').map((o) => o.label)).toEqual(['Remove voucher 1', 'Remove voucher 2', 'Remove voucher 3']);
  expect(validateCorrection({ kind: 'value', item: 'invoices.items.1.remove', reason: 'Not part of this claim.', wrongStep: 'reading' }, options)).toMatchObject({ corrected: true });
  expect(correctionOptions({ invoices: { items: [{ subtotal: 1 }] } }).some((o) => o.type === 'remove')).toBe(false); // the last voucher stays
  expect(recheckFrom('invoices.items.1.remove', 'API_DOCUMENTS_REVIEW').API).toBe('API_RECOGNIZED');
  expect(recheckFrom('invoices.removed.0.restore', 'API_DOCUMENTS_REVIEW').API).toBe('API_RECOGNIZED');
});

it('removes the voucher with its own corrections and numbers the later ones down; Put back undoes it', () => {
  const removed = applyCorrection(fields(), correction('invoices.items.1.remove'));
  expect(removed.invoices.items.map((v) => v.subtotal)).toEqual([36750, 5000]);
  expect(removed.invoices.removed).toEqual([expect.objectContaining({ voucher: 1, item: expect.objectContaining({ subtotal: 218915 }), by: 'ulink', reason: 'Not part of this claim.' })]);
  expect(removed.invoices.removed[0].corrections.map((c) => c.item)).toEqual(['invoices.items.1.date']);
  expect(removed.corrections.map((c) => c.item)).toEqual(['invoices.items.1.subtotal', 'claim.total_claim_amount']);
  expect(correctionOptions(removed).find((o) => o.type === 'restore')).toMatchObject({ item: 'invoices.removed.0.restore', label: 'Put back voucher 2' });

  const back = applyCorrection(removed, correction('invoices.removed.0.restore'));
  expect(back.invoices.items.map((v) => v.subtotal)).toEqual([36750, 218915, 5000]);
  expect(back.invoices.removed).toBeUndefined();
  expect(back.corrections.map((c) => c.item).sort()).toEqual(['claim.total_claim_amount', 'invoices.items.1.date', 'invoices.items.2.subtotal']);
});

it('the assessment (case page, team emails, IAS remark) names the removed voucher, who and why', () => {
  const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
  const removed = applyCorrection(fields(), correction('invoices.items.1.remove'));
  const lineOf = buildAssessmentSummary({ extractedFields: removed }).lines.find((l) => l.decision === 'Vouchers removed by a person');
  expect(lineOf.why).toBe('A removed voucher is not part of this claim, so it is not checked and not sent to IAS: voucher 2 (218,915 MMK, 2026-06-10) removed by ulink — Not part of this claim.');
});

// UAT 17/11 (case 2606100014): a date check marked OK must clear its issue, or the next check holds the case again.
it('Mark OK on a failed date check clears its issue from the result', () => {
  const { applyVerdicts } = require('../modules/ai-feedback/corrections');
  const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');
  const fixture = require('./fixtures/documentChecking/invoice-date-inconsistent.json');
  const f = fixture.extractedFields || fixture.input || fixture;
  const result = evaluateDocumentChecks(f);
  const dateIssues = result.issues.filter((i) => /date/.test(i));
  expect(dateIssues.length).toBeGreaterThan(0);
  const corrections = ['TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT'].map((item) => ({ kind: 'verdict', item, corrected: true, by: 'ulink', reason: 'follow up treatment', aiValue: false }));
  const after = applyVerdicts(result, corrections);
  expect(after.issues.filter((i) => /date/.test(i))).toEqual([]);
});
