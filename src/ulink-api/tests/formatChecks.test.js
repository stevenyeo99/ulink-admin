// SYSTEM_4 E3a (E4-08): format checks on the values the AI read, and a reason on every document check, pass or fail.
// A value that fails a format check is most likely misread: an "AI unsure" review point (holds a passed check with
// switch #3, counts for "open review points block STP") — never an issue, so the documents stay complete.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings } = require('../modules/settings/settings');
const { formatCheck, evaluateDocumentChecks } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { unsureDocumentPoints, unsurePassedPoints } = require('../modules/document-checking/holdForReview');

const TODAY = '2026-10-15';
const fields = (over = {}) => ({
  claimant: { claimant_nrc_passport: '12/DAGAYA(N)081441', claimant_dob: '1981-06-04', ...over.claimant },
  claim: { appointment_date: '2026-10-01', total_claim_amount: 54690, ...over.claim },
  medical: { detail_of_illness_injury: 'Fever' },
  medical_record: { present: true, legible: true, date: '2026-10-01', ...over.medical_record },
  invoices: { present: true, items: over.items || [{ date: '2026-10-01', subtotal: 54690, legible: true, has_clinic_stamp_or_doctor_signature: true }] },
  bank: { bank_name: 'KBZ', bank_account_name: 'Hsu Myat Pyae', bank_account_number: '123', ...over.bank },
});
const problemsOf = (f) => formatCheck(f, TODAY).problems;
const formatPoint = (item) => buildAssessmentSummary({ documentCheckResult: { passed: true, issues: [], details: [], checklist: [item] } })
  .reviewPoints.find((p) => p.decision === 'Values read look valid');

beforeEach(async () => { Setting.findAll.mockResolvedValue([]); await getSettings(); });

it('passes good values and says what it checked', () => {
  expect(formatCheck(fields(), TODAY)).toMatchObject({
    code: 'VALUE_FORMAT', passed: true, confidence: null, problems: [], reason: 'Checked: NRC / passport, dates, amounts.',
  });
});

it('accepts NRCs in Latin or Burmese script, spaced or not, and passport numbers', () => {
  for (const nrc of ['12/DAGAYA(N)081441', '12/LATHANA(E)001787', '7/PAMANA (N) 271984', '၁၂/ဒဂယ(နိုင်)၀၈၁၄၄၁', 'MA123456']) {
    expect(problemsOf(fields({ claimant: { claimant_nrc_passport: nrc } }))).toEqual([]);
  }
});

it('flags an NRC that looks misread', () => {
  expect(problemsOf(fields({ claimant: { claimant_nrc_passport: '12/DAGAYA(N)08144' } })))
    .toEqual(['NRC / passport "12/DAGAYA(N)08144" doesn\'t look like an NRC or passport number']);
});

it('flags dates that are not real, in the future, or a birth after the treatment', () => {
  expect(problemsOf(fields({ medical_record: { date: '2026-02-30' } }))).toEqual(['Medical record date "2026-02-30" is not a real date']);
  expect(problemsOf(fields({ items: [{ date: '2027-01-03', subtotal: 54690 }] }))).toEqual(['Voucher 1 date 2027-01-03 is in the future']);
  expect(problemsOf(fields({ claimant: { claimant_dob: '2026-10-02' } }))).toEqual(['Date of birth 2026-10-02 is after the treatment date 2026-10-01']);
  expect(problemsOf(fields({ claimant: { claimant_dob: '2026-10-01' } }))).toEqual([]); // a newborn, treated the day of birth
});

it('flags amounts that are not amounts; a refund slip (zero / negative) is fine', () => {
  expect(problemsOf(fields({ claim: { total_claim_amount: 0 } }))).toEqual(['Claimed amount "0" is not an amount above zero']);
  expect(problemsOf(fields({ items: [{ subtotal: '54,690' }, { subtotal: -5250 }] }))).toEqual(['Voucher 1 amount "54,690" is not a number']);
});

it('leaves missing values to the mandatory-field check; nothing read → no line', () => {
  expect(problemsOf(fields({ claimant: { claimant_nrc_passport: null }, medical_record: { date: null } }))).toEqual([]);
  expect(formatCheck({}, TODAY)).toBeNull();
});

it('a failed format check is an "AI unsure" review point and holds a passed check — never a missing-documents finding', () => {
  const item = formatCheck(fields({ claimant: { claimant_nrc_passport: '12/DAGAYA(N)08144' } }), TODAY);
  expect(item.confidence).toBe(0);
  expect(formatPoint(item)).toMatchObject({ reason: 'AI unsure' });
  const result = { passed: true, checklist: [item] };
  expect(unsurePassedPoints(result)).toEqual([expect.stringContaining('Values read: NRC / passport "12/DAGAYA(N)08144"')]);
  expect(unsureDocumentPoints(result)).toEqual([]);

  const good = formatCheck(fields(), TODAY);
  expect(formatPoint(good)).toBeUndefined();
  expect(unsurePassedPoints({ passed: true, checklist: [good] })).toEqual([]);
});

it('every document check carries a reason, pass or fail (a mandatory field: found / not found says it)', () => {
  const { checklist } = evaluateDocumentChecks(fields());
  expect(checklist.filter((item) => item.code !== 'MISSING_MANDATORY_FIELD' && !item.reason)).toEqual([]);
  expect(checklist.find((i) => i.code === 'MISSING_BANK_INFO').reason).toBe('Found: bank name, account holder, account number.');
  expect(checklist.find((i) => i.code === 'UNCLEAR_VOUCHER').reason).toBe('No voucher marked unreadable (the voucher).');

  const failed = evaluateDocumentChecks(fields({ items: [{ subtotal: 54690, legible: false, has_clinic_stamp_or_doctor_signature: true }] })).checklist;
  expect(failed.find((i) => i.code === 'UNCLEAR_VOUCHER')).toMatchObject({ passed: false, reason: 'Voucher(s) #1 cannot be read clearly.' });
});

it('the case page shows why the quietly passed checks passed', () => {
  const { checklist } = evaluateDocumentChecks(fields());
  const summary = buildAssessmentSummary({ documentCheckResult: { passed: true, issues: [], details: [], checklist } });
  expect(summary.lines.find((l) => l.decision === 'Other document checks').why).toContain('Bank information present (Found: bank name, account holder, account number)');
});

it('a voucher dated far from the visit is most likely misread (E3 check: a July visit, a voucher read as January)', async () => {
  const items = (date) => [{ date, subtotal: 54690, legible: true, has_clinic_stamp_or_doctor_signature: true }];
  // visit 2026-10-01 (fields() appointment_date)
  expect(problemsOf(fields({ items: items('2026-04-01'), medical_record: { date: null } })))
    .toEqual(['Voucher 1 date 2026-04-01 is 183 days before the visit (appointment) date 2026-10-01']);
  expect(problemsOf(fields({ items: items('2026-09-10'), medical_record: { date: null } }))).toEqual([]); // 21 days: fine
  // The visit date misread instead (July → January): the voucher is then far after it.
  expect(problemsOf(fields({ claim: { appointment_date: '2026-01-05' }, items: items('2026-07-05'), medical_record: { date: null } })))
    .toEqual(['Voucher 1 date 2026-07-05 is 181 days after the visit (appointment) date 2026-01-05']);
  // No appointment date: from the accident date, and it says so.
  expect(problemsOf(fields({ claim: { appointment_date: null, accident_date: '2026-10-01' }, items: items('2026-04-01'), medical_record: { date: null } })))
    .toEqual(['Voucher 1 date 2026-04-01 is 183 days before the accident date 2026-10-01']);
  // The limit is an STP setting.
  Setting.findAll.mockResolvedValue([{ key: 'voucherDaysBeforeVisit', value: 10 }]);
  await getSettings();
  expect(problemsOf(fields({ items: items('2026-09-10'), medical_record: { date: null } })))
    .toEqual(['Voucher 1 date 2026-09-10 is 21 days before the visit (appointment) date 2026-10-01']);
  Setting.findAll.mockResolvedValue([]);
  await getSettings();
});

it('with a medical record date, the invoice-date check still fails as before — the rule adds an unsure point, it does not change who is asked', () => {
  const misread = fields({ items: [{ date: '2026-04-01', subtotal: 54690, legible: true, has_clinic_stamp_or_doctor_signature: true }] }); // record 2026-10-01
  expect(evaluateDocumentChecks(misread).issues).toContain('The invoice date is not consistent with the medical record date. Please provide clarification or a corrected invoice.');
  expect(formatCheck(misread, TODAY).confidence).toBe(0);
});
