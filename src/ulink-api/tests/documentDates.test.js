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

it('an undated medical document is named with its page; a dated one passes', () => {
  expect(check(p('a.pdf - page 1', 'claim_form', '2026-10-08'), p('a.pdf - page 3', 'prescription'), p('a.pdf - page 4', 'voucher')))
    .toMatchObject({ code: 'DOCUMENT_DATES', passed: true, undated: [{ label: 'prescription', pages: ['a.pdf - page 3'] }], note: 'prescription has no date (a.pdf - page 3).' });
  expect(check(p('a.pdf - page 3', 'prescription', '2026-10-01'))).toMatchObject({ undated: [], note: 'The medical document shows a date.' });
  // Eye test slips are a customer item instead (EYE_TEST_SLIP_UNDATED, documentChecks below).
  expect(check(p('a.pdf - page 3', 'eye_test_slip'))).toBeNull();
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
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [check(p('a.pdf - page 3', 'prescription'))] };
  const summary = buildAssessmentSummary({ documentCheckResult });
  expect(summary.lines.find((l) => l.decision === 'Medical documents dated')).toMatchObject({ result: '1 without a date', review: { reason: 'Missing information' } });
  expect(summary.reviewPoints.map((r) => r.decision)).toEqual(['Medical documents dated']);
  expect(unsurePassedPoints(documentCheckResult)).toEqual(['Medical documents without a date: prescription has no date (a.pdf - page 3).']);
  expect(documentCheckResult.issues).toEqual([]);
  expect(correctionOptions({}, documentCheckResult).some((o) => o.item === 'DOCUMENT_DATES')).toBe(false);
});

it('all dated: no review point', () => {
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [check(p('a.pdf - page 3', 'prescription', '2026-10-01'))] };
  expect(buildAssessmentSummary({ documentCheckResult }).reviewPoints).toEqual([]);
  expect(unsurePassedPoints(documentCheckResult)).toEqual([]);
});

// AYA-CL-26043392 as the ULINK staff handled it (2026-10-19): the eye test slip is the vision claim's medical record, and
// the only request to the customer is "Need to fill treatment date in the eye test record".
describe('vision claim (AYA-CL-26043392)', () => {
  const { evaluateDocumentChecks, ISSUES } = require('../modules/document-checking/checklist');
  const fields = (slipDate) => ({
    claim: { appointment_date: '2026-10-08', appointment_time: null },
    medical: { detail_of_illness_injury: 'Glasses' },
    bank: { bank_name: 'AYA bank', bank_account_name: 'Phyo Phyo Han', bank_account_number: '3571050036770244' },
    medical_record: { present: false },
    invoices: { present: true, items: [] },
    document_list: [p('a.pdf - page 1', 'claim_form', '2026-10-08'), p('a.pdf - page 3', 'eye_test_slip', slipDate), p('a.pdf - page 4', 'itemized_invoice', '2026-10-08')],
  });

  it('an undated eye test slip is the one customer item, in the staff wording; no medical report and no appointment time asked', () => {
    const { issues } = evaluateDocumentChecks(fields(null));
    expect(issues).toContain('Need to fill treatment date in the eye test record');
    expect(issues).not.toContain(ISSUES.NO_MEDICAL_REPORT);
    expect(issues.some((i) => /appointment/i.test(i))).toBe(false);
    expect(evaluateDocumentChecks(fields(null)).checklist.some((l) => l.label === 'Claim & Treatment Information: Appointment / Visited Time')).toBe(false);
  });

  it('a date in another form is still a date on the slip: not asked for', () => {
    expect(evaluateDocumentChecks(fields('08/10/2026')).issues).not.toContain(ISSUES.EYE_TEST_SLIP_UNDATED);
  });

  it('a page the AI was unsure is an eye test slip does not stand in for the medical record', () => {
    const f = { ...fields('2026-10-08'), document_list: [{ ...p('a.pdf - page 3', 'eye_test_slip', '2026-10-08'), confidence: 0.3 }] };
    expect(evaluateDocumentChecks(f).issues).toContain(ISSUES.NO_MEDICAL_REPORT);
  });

  it('no eye test slip: no eye test slip line at all (it does not apply)', () => {
    const f = { ...fields(null), document_list: [p('a.pdf - page 1', 'claim_form', '2026-10-08')] };
    expect(evaluateDocumentChecks(f).checklist.some((l) => l.code === 'EYE_TEST_SLIP_UNDATED')).toBe(false);
  });

  it('a dated eye test slip: nothing to ask for that slip', () => {
    expect(evaluateDocumentChecks(fields('2026-10-08')).issues).not.toContain(ISSUES.EYE_TEST_SLIP_UNDATED);
  });

  it('the eye test slip line carries the least sure score and the AI reason with the pages', () => {
    const slip = (page, confidence, reason) => ({ ...p(page, 'eye_test_slip'), confidence, reason });
    const f = { ...fields(null), document_list: [slip('a.pdf - page 3', 0.95, 'SPH/CYL table'), slip('b.pdf - page 2', 0.8, 'eye power slip')] };
    expect(evaluateDocumentChecks(f).checklist.find((l) => l.code === 'EYE_TEST_SLIP_UNDATED')).toMatchObject({
      passed: false, confidence: 0.8, reason: 'SPH/CYL table — no date (a.pdf - page 3); eye power slip — no date (b.pdf - page 2).',
    });
  });

  it('an eye test slip the AI was unsure of holds the customer email for a person', () => {
    const { unsureDocumentPoints } = require('../modules/document-checking/holdForReview');
    const f = { ...fields(null), document_list: [{ ...p('a.pdf - page 3', 'eye_test_slip'), confidence: 0.4 }] };
    expect(unsureDocumentPoints(evaluateDocumentChecks(f))).toEqual(['Need to fill treatment date in the eye test record (AI confidence 0.4)']);
  });

  it('the medical record line passes with the eye test slip score and reason, not the AI "no medical record" text', () => {
    const f = { ...fields(null), medical_record: { present: false, presence_confidence: 1, presence_reason: 'No medical record document found.' } };
    expect(evaluateDocumentChecks(f).checklist.find((l) => l.code === 'NO_MEDICAL_REPORT')).toMatchObject({
      passed: true, confidence: 0.9, reason: 'An eye test slip was found; for a vision claim it is the medical record (r (a.pdf - page 3)).',
    });
  });

  it('without an eye test slip, a missing medical record is still asked for', () => {
    const { issues } = evaluateDocumentChecks({ ...fields(null), document_list: [p('a.pdf - page 1', 'claim_form', '2026-10-08')] });
    expect(issues).toContain(ISSUES.NO_MEDICAL_REPORT);
  });
});
