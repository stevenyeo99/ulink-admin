// Another claim in IAS with the same incurred date (owner 2026-11-12, docs/imp/UAT/IAS_MEMBER_CLAIM_HISTORY_API_SPECS.md):
// the visit date and every voucher date against every IAS claim, whatever its status; the claim being checked left out;
// a match holds the case for a person, bypassed only as an exception, never STP after it. IAS faked.
jest.mock('../modules/member-verification/iasClient', () => ({ getMemberClaimHistory: jest.fn() }));

const { getMemberClaimHistory } = require('../modules/member-verification/iasClient');
const { checkSameDateClaims } = require('../modules/member-verification/sameDateClaims');
const { evaluate } = require('../modules/member-verification/checks');
const { correctionOptions, validateCorrection } = require('../modules/ai-feedback/corrections');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');

const info = { success: true, payload: {
  member: { MBR_REF_NO: 'MEM-1', DOB: '01011990' },
  policies: [{ POCY_NO: 'P1', EFF_DATE: '01012026', EXP_DATE: '12312026' }],
  memberPlans: [{ EFF_DATE: '01012026', EXP_DATE: '12312026' }],
} };
const fields = (extra = {}) => ({
  claim: { appointment_date: '2026-06-01', treatment_outside_myanmar: false },
  claimant: { claimant_dob: '1990-01-01' },
  invoices: { items: [{ subtotal: 30000, date: '2026-06-01' }, { subtotal: 9000, date: '2026-06-05' }] },
  ...extra,
});
const history = (claims) => ({ success: true, payload: { memberRefNo: 'MEM-1', meplEffDate: '2026-06-01', claims } });
const THIS = { claimNo: 'CLM-9', tpaCaseNumber: 'AYA-CL-9', incurredDate: '2026-06-01', incurredDates: ['2026-06-01'], status: 'CL_STATUS_RA' };
const OTHER = { claimNo: 'CLM-1', tpaCaseNumber: null, incurredDate: '2026-06-05', incurredDates: ['2026-06-05', '2026-05-01'], status: 'CL_STATUS_NC' };

beforeEach(() => jest.clearAllMocks());

it('asks IAS with the member number and the visit date; a voucher date that matches another claim is a finding', async () => {
  getMemberClaimHistory.mockResolvedValue(history([THIS, OTHER]));
  const check = await checkSameDateClaims(fields(), info, { claimNo: 'CLM-9' });
  expect(getMemberClaimHistory).toHaveBeenCalledWith({ memberRefNo: 'MEM-1', meplEffDate: '2026-06-01' });
  expect(check).toMatchObject({ checked: true, matches: [{ claimNo: 'CLM-1', dates: ['2026-06-05'], status: 'CL_STATUS_NC' }] });
  expect(check.issue).toMatchObject({ item: 'member:same_date_claim', reasonCode: 'SAME_DATE_CLAIM', coverKeys: ['CLM-1|2026-06-05'] });
  expect(check.issue.reason).toContain('claim CLM-1 on 2026-06-05, status CL_STATUS_NC');
  expect(check.matches[0].sameCaseNumber).toBe(false);
});

it('API: the claim being checked is left out by its claim number only; no other match is no finding', async () => {
  getMemberClaimHistory.mockResolvedValue(history([THIS]));
  expect(await checkSameDateClaims(fields(), info, { claimNo: 'CLM-9' })).toMatchObject({ checked: true, issue: null });
  // Another IAS claim with the same TPA case number but another claim number is not left out.
  getMemberClaimHistory.mockResolvedValue(history([THIS, { ...THIS, claimNo: 'CLM-8' }]));
  expect((await checkSameDateClaims(fields(), info, { claimNo: 'CLM-9' })).matches.map((m) => m.claimNo)).toEqual(['CLM-8']);
});

it('email: an IAS claim with the claim form\'s own TPA case number is flagged whatever its date', async () => {
  const sent = { claimNo: 'CLM-7', tpaCaseNumber: 'AYA-CL-9', incurredDate: '2026-03-01', incurredDates: ['2026-03-01'], status: 'CL_STATUS_NC' };
  getMemberClaimHistory.mockResolvedValue(history([sent, THIS]));
  const check = await checkSameDateClaims(fields(), info, { claimNo: null, caseNumber: 'AYA-CL-9' });
  expect(check.matches).toEqual([
    { claimNo: 'CLM-7', tpaCaseNumber: 'AYA-CL-9', status: 'CL_STATUS_NC', dates: [], sameCaseNumber: true },
    { claimNo: 'CLM-9', tpaCaseNumber: 'AYA-CL-9', status: 'CL_STATUS_RA', dates: ['2026-06-01'], sameCaseNumber: true },
  ]);
  expect(check.issue.reason).toContain('claim CLM-7 for the same TPA case number AYA-CL-9, status CL_STATUS_NC');
  expect(check.issue.coverKeys).toEqual(['CLM-7|case', 'CLM-9|2026-06-01', 'CLM-9|case']);
  // Checked again once its own IAS claim exists: that claim is left out by its number.
  expect((await checkSameDateClaims(fields(), info, { claimNo: 'CLM-9', caseNumber: 'AYA-CL-9' })).matches.map((m) => m.claimNo)).toEqual(['CLM-7']);
});

it('an accident claim compares the accident date and the visit date; IAS is asked with the accident date', async () => {
  getMemberClaimHistory.mockResolvedValue(history([{ claimNo: 'CLM-4', incurredDate: '2026-06-03', incurredDates: ['2026-06-03'], status: 'CL_STATUS_NC' }]));
  const accident = fields({ claim: { accident_date: '2026-06-01', appointment_date: '2026-06-03' }, invoices: { items: [] } });
  const check = await checkSameDateClaims(accident, info, {});
  expect(getMemberClaimHistory).toHaveBeenCalledWith({ memberRefNo: 'MEM-1', meplEffDate: '2026-06-01' });
  expect(check.matches.map((m) => [m.claimNo, m.dates])).toEqual([['CLM-4', ['2026-06-03']]]);
});

it('every status counts; a claim with only incurredDate is read too', async () => {
  getMemberClaimHistory.mockResolvedValue(history([{ claimNo: 'CLM-2', incurredDate: '2026-06-01', status: 'CL_STATUS_CANCELLED' }]));
  expect((await checkSameDateClaims(fields(), info, {})).matches).toEqual([{ claimNo: 'CLM-2', tpaCaseNumber: null, status: 'CL_STATUS_CANCELLED', dates: ['2026-06-01'], sameCaseNumber: false }]);
});

it('IAS cannot answer, or no member number or visit date: not checked, nothing stops the case', async () => {
  getMemberClaimHistory.mockResolvedValue({ success: false, error: 'No member coverage found for the supplied memberRefNo and meplEffDate.' });
  expect(await checkSameDateClaims(fields(), info, {})).toMatchObject({ checked: false, issue: null, note: expect.stringContaining('No member coverage found') });
  expect(await checkSameDateClaims(fields(), { success: true, payload: { member: {} } }, {})).toMatchObject({ checked: false, issue: null });
  expect(await checkSameDateClaims(fields({ claim: {} }), info, {})).toMatchObject({ checked: false, issue: null });
  expect(getMemberClaimHistory).toHaveBeenCalledTimes(1);
});

it('holds the case at member review; the only action is a bypass as an exception; a new claim is a new decision', async () => {
  getMemberClaimHistory.mockResolvedValue(history([OTHER]));
  const { issue } = await checkSameDateClaims(fields(), info, {});
  const held = evaluate(fields(), info, [issue]);
  expect(held).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'SAME_DATE_CLAIM' });

  const option = correctionOptions(fields(), null, held).find((o) => o.item === 'member:same_date_claim');
  expect(option).toMatchObject({ canFail: false, coverKeys: ['CLM-1|2026-06-05'] });
  const body = { kind: 'verdict', item: 'member:same_date_claim', passed: true, reason: 'A different visit that day' };
  expect(validateCorrection({ ...body, wrongStep: 'check' }, [option]).error).toMatch(/bypassed as an exception/);
  expect(validateCorrection({ ...body, wrongStep: 'exception' }, [option]).error).toBeUndefined();

  const bypass = { kind: 'verdict', item: 'member:same_date_claim', corrected: true, coverKeys: ['CLM-1|2026-06-05'], by: 'ulink', reason: 'A different visit that day' };
  expect(evaluate(fields({ corrections: [bypass] }), info, [issue]).outcome).toBe('MEMBER_VERIFIED');
  const another = { ...issue, coverKeys: [...issue.coverKeys, 'CLM-3|2026-06-01'] };
  expect(evaluate(fields({ corrections: [bypass] }), info, [another]).outcome).toBe('MEMBER_REVIEW_REQUIRED');
});

it('a bypassed match, or claims not checked, never goes STP; the AI summary shows the line', () => {
  const stp = (input) => evaluateStp({ rules: [], blockedDiagnoses: [] }, { source: 'API', currency: 'MMK', lines: [], diagCode: 'R50.9', ...input });
  expect(stp({ sameDateLetThrough: true }).reasons).toContain('IAS has a claim with the same incurred date that a person let through, or the IAS claims could not be checked — a person approves.');
  expect(stp({}).reasons.join(' ')).not.toContain('same incurred date');

  const summary = buildAssessmentSummary({ source: 'API', memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', sameDateClaims: { checked: true, note: null, matches: [{ claimNo: 'CLM-1', dates: ['2026-06-05'], status: 'CL_STATUS_NC' }] } } });
  expect(summary.lines.find((l) => l.decision === 'Same incurred date in IAS')).toMatchObject({ result: 'Found', status: 'issue', why: 'Claim CLM-1 on 2026-06-05 (CL_STATUS_NC)' });
});
