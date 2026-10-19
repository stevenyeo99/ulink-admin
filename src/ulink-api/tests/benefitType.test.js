// System checklist step 2 (owner, 2026-10-19): the IAS benefit type the documents point to (IP / DT / VS / OP; IAS has
// no vaccination type, so a vaccination is OP), by a rule on "Type of Patient", the documents found and the optical
// voucher type — no AI. Information only. The document kinds here are the ones the staff named for the samples in
// docs/imp/CR/SYSTEM_4/samples (human_checklist.md).

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { benefitTypeCheck } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { unsurePassedPoints } = require('../modules/document-checking/holdForReview');
const { correctionOptions } = require('../modules/ai-feedback/corrections');

const page = (kind, n) => ({ page: `claim.pdf - page ${n}`, kind, date: '2026-10-08', confidence: 0.9, reason: 'r' });
const claim = (kinds, { patient = 'Outpatient', vouchers = [] } = {}) => ({
  claim: { type_of_patient: patient },
  invoices: { items: vouchers },
  document_list: [page('claim_form', 1), ...kinds.map((k, i) => page(k, i + 2))],
});
const typeOf = (fields) => {
  const t = benefitTypeCheck(fields)?.benefitType;
  return t && `${t.code}${t.treatment ? ` ${t.treatment}` : ''}`;
};

beforeEach(() => getSettings());

it('names the IAS benefit type of each sample from its documents', () => {
  expect(typeOf(claim(['eye_test_slip', 'voucher']))).toBe('VS'); // AYA-CL-26043392
  expect(typeOf(claim(['consultation_note', 'medical_book_cover', 'eye_test_slip', 'itemized_invoice']))).toBe('VS'); // AYA-CL-26043792
  expect(typeOf(claim(['dental_consultation', 'medical_book_cover', 'itemized_invoice']))).toBe('DT'); // AYA-CL-26043766
  expect(typeOf(claim(['doctor_recommendation', 'vaccination_record', 'itemized_invoice']))).toBe('OP vaccination'); // AYA-CL-26043951
  expect(typeOf(claim(['discharge_summary', 'itemized_invoice', 'investigation_report'], { patient: 'Inpatient' }))).toBe('IP'); // AYA-CL-26040093
  expect(typeOf(claim(['consultation_note', 'voucher']))).toBe('OP'); // AYA-CL-26041363
});

it('says why: the pages, and an optical voucher counts for vision', () => {
  expect(benefitTypeCheck(claim(['voucher'], { vouchers: [{ voucher_type: 'optical', evidence: { page: 'claim.pdf - page 2' } }] })))
    .toMatchObject({ code: 'BENEFIT_TYPE', passed: true, benefitType: { code: 'VS', desc: 'Vision' }, note: 'VS Vision — optical voucher 1, claim.pdf - page 2.' });
  expect(benefitTypeCheck(claim(['vaccination_record'])).note).toBe('OP Outpatient (vaccination) — vaccination record, claim.pdf - page 2.');
  expect(benefitTypeCheck(claim(['consultation_note'])).note).toBe('OP Outpatient — no inpatient, vaccination, dental or vision document found; claim form: Outpatient.');
});

it('names the other types too, and a claim form that disagrees', () => {
  expect(benefitTypeCheck(claim(['dental_consultation', 'eye_test_slip']))).toMatchObject({
    benefitType: { code: 'DT' }, alsoTypes: [{ code: 'VS' }], note: 'DT Dental — dental consultation, claim.pdf - page 2. Also: VS Vision.',
  });
  expect(benefitTypeCheck(claim(['discharge_summary'])).note).toBe('IP Inpatient — discharge summary, claim.pdf - page 2. The claim form says Outpatient.');
});

it('reads the usual ways a claim form says inpatient, and shows the words read', () => {
  for (const patient of ['Inpatient', 'In-patient', 'In Patient', 'IPD']) expect(typeOf(claim([], { patient }))).toBe('IP');
  expect(benefitTypeCheck(claim([], { patient: 'In-patient' })).note).toBe('IP Inpatient — claim form: In-patient.');
  expect(typeOf(claim([], { patient: null }))).toBe('OP');
  expect(typeOf({ document_list: [page('voucher', 1)] })).toBe('OP'); // no claim form fields, no vouchers
});

it("a doctor's recommendation alone is not vaccination (consultations carry them too)", () => {
  expect(typeOf(claim(['doctor_recommendation', 'voucher']))).toBe('OP');
});

it('no document list (a case read before step 1): no line', () => {
  expect(benefitTypeCheck({ claim: { type_of_patient: 'Inpatient' } })).toBeNull();
});

it('is information only: no review point, no hold, nothing to correct', () => {
  const documentCheckResult = { passed: true, issues: [], details: [], checklist: [benefitTypeCheck(claim(['vaccination_record']))] };
  const summary = buildAssessmentSummary({ documentCheckResult });
  expect(summary.lines.find((l) => l.decision === 'Benefit type')).toMatchObject({ result: 'OP Outpatient (vaccination)', status: 'ok', review: null });
  expect(summary.reviewPoints).toEqual([]);
  expect(unsurePassedPoints(documentCheckResult)).toEqual([]);
  expect(correctionOptions({}, documentCheckResult).some((o) => o.item === 'BENEFIT_TYPE')).toBe(false);
});
