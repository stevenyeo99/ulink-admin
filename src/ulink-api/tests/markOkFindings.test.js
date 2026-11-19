// Mark OK where a document finding had no action (UAT 17/11, owner 2026-11-19): a medical document without a date, and a
// missing mandatory field with nothing to edit. Saved as a verdict; the next document check respects it. No database.
const { correctionOptions, validateCorrection, applyVerdicts } = require('../modules/ai-feedback/corrections');

const dates = (note) => ({ code: 'DOCUMENT_DATES', label: 'Medical documents dated', passed: true, confidence: 0, undated: [{ label: 'consultation note', pages: ['claim.pdf - page 3'] }], note });
const mandatory = (label, editItems) => ({ code: 'MISSING_MANDATORY_FIELD', label, passed: false, ...(editItems ? { editItems } : {}) });
const result = (checklist) => ({
  passed: false,
  issues: ['Please provide the missing email.', 'Please provide the missing phone number.'],
  details: [{ issue: 'Please provide the missing email.', code: 'MISSING_MANDATORY_FIELD' }, { issue: 'Please provide the missing phone number.', code: 'MISSING_MANDATORY_FIELD' }],
  flags: [{ code: 'MISSING_MANDATORY_FIELD', section: 'Policy & Member Information', field: 'Email' }, { code: 'MISSING_MANDATORY_FIELD', section: 'Policy & Member Information', field: 'Phone Number' }],
  checklist,
});
const verdict = (item, extra = {}) => ({ kind: 'verdict', item, corrected: true, by: 'ulink', reason: 'Page 3 is the medical book cover.', aiValue: false, wrongStep: 'check', ...extra });

it('offers Mark OK on undated documents and on each missing field with nothing to edit', () => {
  const checked = result([dates('consultation note has no date (claim.pdf - page 3).'), mandatory('Policy & Member Information: Email'),
    mandatory('Policy & Member Information: Phone Number'), mandatory('Bank Information: Account Number', ['bank.bank_account_number'])]);
  const options = correctionOptions({}, checked).filter((o) => o.kind === 'verdict');
  expect(options.map((o) => o.item)).toEqual(['DOCUMENT_DATES', 'MISSING_MANDATORY_FIELD:Policy & Member Information: Email', 'MISSING_MANDATORY_FIELD:Policy & Member Information: Phone Number']);
  expect(options[0]).toMatchObject({ current: false, covers: 'claim.pdf - page 3' });
  expect(validateCorrection({ kind: 'verdict', item: options[1].item, passed: true, reason: 'The form has no email box.', wrongStep: 'check' }, options)).toMatchObject({ corrected: true });
});

it('a missing field marked OK drops only its own request; the other stays', () => {
  const checked = result([mandatory('Policy & Member Information: Email'), mandatory('Policy & Member Information: Phone Number')]);
  const after = applyVerdicts(checked, [verdict('MISSING_MANDATORY_FIELD:Policy & Member Information: Email')]);
  expect(after.issues).toEqual(['Please provide the missing phone number.']);
  expect(after.checklist.map((l) => l.passed)).toEqual([true, false]);
  expect(after.passed).toBe(false);
});

it('undated documents marked OK are sure (no hold) while the same pages are undated; a new undated page is held again', () => {
  const covers = 'claim.pdf - page 3';
  // Other wording of the note, the same pages: still covered.
  const same = applyVerdicts(result([dates('consultation note has an unclear date (claim.pdf - page 3).')]), [verdict('DOCUMENT_DATES', { covers })]);
  expect(same.checklist[0]).toMatchObject({ passed: true, confidence: 1 });
  expect(correctionOptions({}, same).some((o) => o.item === 'DOCUMENT_DATES')).toBe(false); // decided: not offered again
  const more = { ...dates('two pages'), undated: [{ label: 'consultation note', pages: ['claim.pdf - page 3', 'claim.pdf - page 9'] }] };
  const changed = applyVerdicts(result([more]), [verdict('DOCUMENT_DATES', { covers })]);
  expect(changed.checklist[0].confidence).toBe(0);
});
