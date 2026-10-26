// SYSTEM_5 member balance, phase B: the balance in the member check (memberBalance.js), the member:balance finding and
// its bypass (checks.js evaluate), and no STP after a bypass (stpEligibility.js). The AI pick and IAS are faked.
jest.mock('../modules/ias-claim-preparation/benefitPicker', () => ({ pickBenefit: jest.fn() }));
jest.mock('../modules/member-verification/iasClient', () => ({ getMemberLimitBalance: jest.fn(), getMemberInfo: jest.fn() }));

const { pickBenefit } = require('../modules/ias-claim-preparation/benefitPicker');
const { getMemberLimitBalance } = require('../modules/member-verification/iasClient');
const { checkMemberBalance } = require('../modules/member-verification/memberBalance');
const { evaluate } = require('../modules/member-verification/checks');
const { correctionOptions } = require('../modules/ai-feedback/corrections');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const sample = require('./fixtures/memberBalance/ias-balance-sample.json');

// The member info answer: its member ref, policy and plan (2311 revision 01, the sample's) — all checks pass.
const info = {
  success: true,
  payload: {
    member: { MBR_REF_NO: 'M1', DOB: '01011990' },
    policies: [{ POCY_REF_NO: 'P1', EFF_DATE: '09012025' }],
    memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030', plan: { PLAN_ID: '2311', REV_NO: '01' } }],
  },
};
const fields = (items, extra = {}) => ({
  claim: { appointment_date: '2026-09-01', type_of_patient: 'Inpatient', total_claim_amount: 1 },
  claimant: { claimant_dob: '1990-01-01' },
  invoices: { items },
  ...extra,
});
const surgeon = (subtotal) => ({ subtotal, date: '2026-09-01', voucher_type: 'other' });

beforeEach(() => {
  jest.clearAllMocks();
  pickBenefit.mockResolvedValue({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.9, reason: 'surgery' });
  getMemberLimitBalance.mockResolvedValue(sample);
});

it('picks a head per voucher, asks IAS with the member values, and raises member:balance for a short voucher', async () => {
  const balance = await checkMemberBalance(fields([surgeon(5000000), surgeon(5000000)]), info);
  expect(getMemberLimitBalance).toHaveBeenCalledWith({ memberRefNo: 'M1', policyRefNo: 'P1', policyEffDate: '09012025' });
  expect(pickBenefit).toHaveBeenCalledTimes(2);
  expect(balance.lines.map((l) => l.enough)).toEqual([true, false]);
  expect(balance.issue).toEqual({
    item: 'member:balance', reasonCode: 'BALANCE_NOT_ENOUGH',
    reason: 'Balance not enough: Voucher 2 (IP Inpatient / SUR Surgeon’s Fee): voucher 5,000,000, balance left 3,587,070 (CT combined), not enough.',
  });
});

it('reuses a saved pick while the voucher is unchanged: no new AI call', async () => {
  const first = await checkMemberBalance(fields([surgeon(100000)]), info);
  pickBenefit.mockClear();
  await checkMemberBalance(fields([surgeon(100000)]), info, first.picks);
  expect(pickBenefit).not.toHaveBeenCalled();
  await checkMemberBalance(fields([surgeon(200000)]), info, first.picks); // the amount changed: picked again
  expect(pickBenefit).toHaveBeenCalledTimes(1);
});

it('an unsure head is checked against the type the claim form names; no voucher: the claim total', async () => {
  // Outpatient: T OP is 0 in the sample (used up).
  pickBenefit.mockResolvedValue({ pick: null, confidence: 0.3, reason: 'not sure' });
  const memberPlans = [{ ...info.payload.memberPlans[0], coverageLimits: [{ benefits: [{ benefit_type_code: 'OP', benefit_type_desc: 'Outpatient' }] }] }];
  const opInfo = { ...info, payload: { ...info.payload, memberPlans } };
  const unsure = await checkMemberBalance(fields([surgeon(1000)], { claim: { type_of_patient: 'Outpatient' } }), opInfo);
  expect(unsure.picks[0]).toMatchObject({ benefitHead: null, confidence: 0.3 });
  expect(unsure.lines[0]).toMatchObject({ benefitHead: null, limit: 'T OP', enough: false });

  const none = await checkMemberBalance(fields([], { claim: { type_of_patient: 'Outpatient', total_claim_amount: 5000 } }), opInfo);
  expect(none.lines[0].text).toBe('Claim total (OP Outpatient): claimed 5,000, balance 0 (T OP), not enough');
});

it('a balance IAS cannot give is not checked and stops nothing', async () => {
  getMemberLimitBalance.mockResolvedValue({ success: false, error: 'no record' });
  expect(await checkMemberBalance(fields([surgeon(1)]), info)).toMatchObject({ checked: false, issue: null, note: 'IAS did not return the balance (no record).' });
  getMemberLimitBalance.mockResolvedValue(sample);
  const otherPlan = { ...info, payload: { ...info.payload, memberPlans: [{ plan: { PLAN_ID: '9', REV_NO: '01' } }] } };
  expect(await checkMemberBalance(fields([surgeon(1)]), otherPlan)).toMatchObject({ checked: false, issue: null });
  getMemberLimitBalance.mockRejectedValue(new Error('IAS member limit balance request failed with status 502'));
  await expect(checkMemberBalance(fields([surgeon(1)]), info)).rejects.toThrow('502'); // the member check runs again next time
});

it('member:balance holds the case; a bypass with a reason (mark OK) on the same finding lets it go on', async () => {
  const { issue } = await checkMemberBalance(fields([surgeon(5000000), surgeon(5000000)]), info);
  const held = evaluate(fields([]), info, [issue]);
  expect(held).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BALANCE_NOT_ENOUGH' });

  // The only action offered: mark OK (the review page's "Bypass"), never fail.
  const option = correctionOptions(fields([]), null, held).find((o) => o.item === 'member:balance');
  expect(option).toMatchObject({ kind: 'verdict', canFail: false, note: issue.reason });

  const bypass = { kind: 'verdict', item: 'member:balance', corrected: true, covers: issue.reason, reason: 'Partial payment agreed', by: 'Ops' };
  const passed = evaluate(fields([], { corrections: [bypass] }), info, [issue]);
  expect(passed).toMatchObject({ outcome: 'MEMBER_VERIFIED', accepted: [{ item: 'member:balance', acceptedReason: 'Partial payment agreed' }] });

  // A changed balance is a new finding: held again.
  const changed = { ...issue, reason: issue.reason.replace('3,587,070', '1,000,000') };
  expect(evaluate(fields([], { corrections: [bypass] }), info, [changed]).outcome).toBe('MEMBER_REVIEW_REQUIRED');
});

it('a bypassed balance never goes STP', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'IP', currency: 'MMK', stpAllowed: true, amountLimit: 1000000 }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', lines: [{ benefitType: 'IP', subtotal: 1000 }], diagCode: 'J06.9' };
  expect(evaluateStp(config, input).isStp).toBe(true);
  expect(evaluateStp(config, { ...input, balanceBypassed: true })).toMatchObject({ isStp: false, reasons: ['The balance was not enough and a person let the case go on — a person approves.'] });
});

it('a refund slip is not checked and never lowers a shared limit; it costs no AI call', async () => {
  const refund = { subtotal: -200000, date: '2026-09-01', voucher_type: 'other' };
  const balance = await checkMemberBalance(fields([refund, surgeon(8600000)]), info);
  expect(pickBenefit).toHaveBeenCalledTimes(1);
  expect(balance.lines.map((l) => [l.enough, l.balanceLeft])).toEqual([[null, null], [false, 8587070]]);
});

it('no AI call when IAS gives no balance; a changed type of patient picks again', async () => {
  getMemberLimitBalance.mockResolvedValueOnce({ success: false });
  await checkMemberBalance(fields([surgeon(1000)]), info);
  expect(pickBenefit).not.toHaveBeenCalled();

  const first = await checkMemberBalance(fields([surgeon(1000)]), info);
  pickBenefit.mockClear();
  await checkMemberBalance(fields([surgeon(1000)], { claim: { type_of_patient: 'Outpatient' } }), info, first.picks);
  expect(pickBenefit).toHaveBeenCalledTimes(1);
});

it('a bypass is an exception, never an AI mistake', async () => {
  const { issue } = await checkMemberBalance(fields([surgeon(5000000), surgeon(5000000)]), info);
  const options = correctionOptions(fields([]), null, evaluate(fields([]), info, [issue]));
  const { validateCorrection } = require('../modules/ai-feedback/corrections');
  const body = { kind: 'verdict', item: 'member:balance', passed: true, reason: 'Partial payment agreed' };
  expect(validateCorrection({ ...body, wrongStep: 'check' }, options)).toEqual({ error: 'A short balance is bypassed as an exception.' });
  expect(validateCorrection({ ...body, wrongStep: 'exception' }, options)).toMatchObject({ corrected: true });
});
