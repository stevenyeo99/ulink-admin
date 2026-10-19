// System checklist step 3 (owner, 2026-10-19): every medical document shows a date — AYA-CL-26043392's eye test slip had
// none, and the staff asked for a dated one. A rule on the documents found; pages of one document (same kind, one after
// the other, same file) count together. A document without a date is a review point (owner: prevent risky processing),
// never an issue: the documents stay complete and the customer is not asked.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { documentDatesCheck } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { unsurePassedPoints } = require('../modules/document-checking/holdForReview');
const { correctionOptions } = require('../modules/ai-feedback/corrections');

const p = (page, kind, date = null) => ({ page, kind, date, confidence: 0.9, reason: 'r' });
const check = (...pages) => documentDatesCheck({ document_list: pages });

beforeEach(() => getSettings());

it('an undated eye test slip is named with its page; a dated one passes (AYA-CL-26043392)', () => {
  expect(check(p('a.pdf - page 1', 'claim_form', '2026-10-08'), p('a.pdf - page 3', 'eye_test_slip'), p('a.pdf - page 4', 'voucher')))
    .toMatchObject({ code: 'DOCUMENT_DATES', passed: true, undated: [{ label: 'eye test slip', pages: ['a.pdf - page 3'] }], note: 'eye test slip has no date (a.pdf - page 3).' });
  expect(check(p('a.pdf - page 3', 'eye_test_slip', '2026-10-01'))).toMatchObject({ undated: [], note: 'The medical document shows a date.' });
});

it('a document over several pages is dated if one of its pages is; the same kind in another file is another document', () => {
  const summary = [p('a.pdf - page 2', 'discharge_summary', '2026-09-30'), p('a.pdf - page 3', 'discharge_summary'), p('a.pdf - page 4', 'discharge_summary')];
  expect(check(...summary).undated).toEqual([]);
  expect(check(...summary, p('b.pdf - page 1', 'discharge_summary')).undated).toEqual([{ label: 'discharge summary', pages: ['b.pdf - page 1'], dateRead: null }]);
});

it('two one-page documents side by side are two (two prescriptions); pages without a label never join', () => {
  expect(check(p('a.pdf - page 2', 'prescription', '2026-09-01'), p('a.pdf - page 3', 'prescription')).undated)
    .toEqual([{ label: 'prescription', pages: ['a.pdf - page 3'], dateRead: null }]);
  expect(check(p(null, 'consultation_note', '2026-10-01'), p(null, 'consultation_note')).undated).toHaveLength(1);
});

it('an unclear date counts as none and shows what the AI wrote', () => {
  expect(check({ ...p('a.pdf - page 2', 'prescription'), date: '12/10/2026' }).note).toBe('prescription has an unclear date ("12/10/2026") (a.pdf - page 2).');
});

it('only medical documents: vouchers, claim form, bank / ID and the like are not checked', () => {
  expect(check(p('a.pdf - page 1', 'claim_form'), p('a.pdf - page 2', 'voucher'), p('a.pdf - page 3', 'bank_or_id_document'), p('a.pdf - page 4', 'medical_book_cover'))).toBeNull();
  expect(documentDatesCheck({})).toBeNull();
});

it('an undated document is a review point (STP stops, a passed check waits for a person) — never an issue', () => {
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [check(p('a.pdf - page 3', 'eye_test_slip'))] };
  const summary = buildAssessmentSummary({ documentCheckResult });
  expect(summary.lines.find((l) => l.decision === 'Medical documents dated')).toMatchObject({ result: '1 without a date', review: { reason: 'Missing information' } });
  expect(summary.reviewPoints.map((r) => r.decision)).toEqual(['Medical documents dated']);
  expect(unsurePassedPoints(documentCheckResult)).toEqual(['Medical documents without a date: eye test slip has no date (a.pdf - page 3).']);
  expect(documentCheckResult.issues).toEqual([]);
  expect(correctionOptions({}, documentCheckResult).some((o) => o.item === 'DOCUMENT_DATES')).toBe(false);
});

it('all dated: no review point', () => {
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [check(p('a.pdf - page 3', 'eye_test_slip', '2026-10-01'))] };
  expect(buildAssessmentSummary({ documentCheckResult }).reviewPoints).toEqual([]);
  expect(unsurePassedPoints(documentCheckResult)).toEqual([]);
});
