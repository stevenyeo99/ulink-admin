// SYSTEM_5 member balance, phase B: the balance in the member check (memberBalance.js), the member:balance finding and
// its bypass (checks.js evaluate), and no STP after a bypass (stpEligibility.js). The AI pick and IAS are faked.
jest.mock('../modules/ias-claim-preparation/benefitPicker', () => ({ pickBenefit: jest.fn() }));
jest.mock('../modules/member-verification/iasClient', () => ({ getMemberLimitBalance: jest.fn(), getMemberInfo: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/medicalTranslation', () => ({ toEnglishMedicalText: jest.fn(async (t) => ({ ...t, translation: null })) }));

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
    coverKeys: ['2|IP|SUR|5000000'],
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

  expect(option.coverKeys).toEqual(['2|IP|SUR|5000000']);
  const bypass = { kind: 'verdict', item: 'member:balance', corrected: true, covers: issue.reason, coverKeys: option.coverKeys, reason: 'Partial payment agreed', by: 'Ops' };
  const passed = evaluate(fields([], { corrections: [bypass] }), info, [issue]);
  expect(passed).toMatchObject({ outcome: 'MEMBER_VERIFIED', accepted: [{ item: 'member:balance', acceptedReason: 'Partial payment agreed' }] });

  // Option A1: the balance moved in IAS, the same voucher is short — still bypassed.
  const moved = { ...issue, reason: issue.reason.replace('3,587,070', '1,000,000') };
  expect(evaluate(fields([], { corrections: [bypass] }), info, [moved]).outcome).toBe('MEMBER_VERIFIED');
  // A new short voucher (or a changed amount or head) is a new decision: held again.
  const another = { ...issue, coverKeys: [...issue.coverKeys, '1|IP|SUR|5000000'] };
  expect(evaluate(fields([], { corrections: [bypass] }), info, [another]).outcome).toBe('MEMBER_REVIEW_REQUIRED');
});

it('a bypassed balance never goes STP', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'IP', currency: 'MMK', stpAllowed: true, amountLimit: 1000000 }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', lines: [{ benefitType: 'IP', subtotal: 1000 }], diagCode: 'J06.9' };
  expect(evaluateStp(config, input).isStp).toBe(true);
  expect(evaluateStp(config, { ...input, balanceBypassed: true })).toMatchObject({ isStp: false, reasons: ['The member balance was not enough (a person let the case go on) or could not be checked before the claim — a person approves.'] });
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

// Phase C: Choose the benefit.
describe('Choose the benefit (phase C)', () => {
  const { savedHead, withChosenPicks } = require('../modules/member-verification/memberBalance');

  it('lists the vouchers the AI was unsure of, by the same rule as claim preparation', async () => {
    pickBenefit
      .mockResolvedValueOnce({ pick: null, confidence: 0.3 }) // no pick
      .mockResolvedValueOnce({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.6 }) // at or below 0.7
      .mockResolvedValueOnce({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.9 }); // sure
    const balance = await checkMemberBalance(fields([surgeon(1000), surgeon(2000), surgeon(3000)]), info);
    expect(balance.unsure).toEqual([]); // the fake member plan has no benefits to choose from: no stop
    const withPlan = { ...info, payload: { ...info.payload, memberPlans: [{ ...info.payload.memberPlans[0], coverageLimits: [{ benefits: [{ benefit_type_code: 'IP', benefit_type_desc: 'Inpatient', benefit_head_code: 'SUR' }] }] }] } };
    pickBenefit
      .mockResolvedValueOnce({ pick: null, confidence: 0.3 })
      .mockResolvedValueOnce({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.6 })
      .mockResolvedValueOnce({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.9 });
    const planned = await checkMemberBalance(fields([surgeon(1000), surgeon(2000), surgeon(3000)]), withPlan);
    expect(planned.unsure).toEqual([0, 1]);
  });

  it("a person's choice counts as sure, and survives a corrected amount (same voucher type)", async () => {
    pickBenefit.mockResolvedValue({ pick: null, confidence: 0.3 });
    const first = await checkMemberBalance(fields([surgeon(1000)]), info);
    const chosen = { ...first.picks[0], benefitType: 'IP', benefitHead: 'SUR', chosen: true, by: 'Ops', comment: 'Surgery bill' };
    pickBenefit.mockClear();
    const again = await checkMemberBalance(fields([surgeon(5000)]), info, [chosen]); // amount corrected 1,000 → 5,000
    expect(pickBenefit).not.toHaveBeenCalled();
    expect(again.unsure).toEqual([]);
    expect(again.lines[0]).toMatchObject({ benefitHead: 'SUR', amount: 5000 });
  });

  it('merges a person\'s choices over the last picks, and hands claim preparation the head the balance used', () => {
    const item = surgeon(1000);
    const basis = { typeOfPatient: 'Inpatient', plan: { planId: '2311', revNo: '01' } };
    const key = { subtotal: 1000, date: '2026-09-01', voucherType: 'other' };
    const ai = { voucher: 0, key, basis, benefitType: null, benefitHead: null, confidence: 0.3 };
    const person = { voucher: 0, key, basis, benefitType: 'IP', benefitHead: 'SUR', chosen: true, by: 'Ops' };
    const merged = withChosenPicks({ balance: { picks: [ai] } }, [person]);
    expect(merged.balance.picks).toEqual([person]);

    const f = fields([item]);
    expect(savedHead(merged, 0, item, info, f)).toMatchObject({ benefitHead: 'SUR', chosen: true });
    expect(savedHead({ balance: { picks: [ai] } }, 0, item, info, f)).toBeNull(); // unsure: preparation picks itself
    expect(savedHead(merged, 0, item, info, fields([item], { claim: { type_of_patient: 'Outpatient' } }))).toBeNull(); // basis changed
  });
});

// Phase D: the second balance check at claim preparation (option B1).
describe('second balance check (phase D)', () => {
  const { recheckBalance } = require('../modules/member-verification/memberBalance');
  const items = [surgeon(5000000), surgeon(5000000)];
  const heads = [{ benefitType: 'IP', benefitHead: 'SUR' }, { benefitType: 'IP', benefitHead: 'SUR' }];
  const basis = { typeOfPatient: 'Inpatient', plan: { planId: '2311', revNo: '01' } };
  const memberResult = { balance: { picks: items.map((item, i) => ({ voucher: i, key: { subtotal: item.subtotal, date: item.date, voucherType: item.voucher_type }, basis, benefitType: 'IP', benefitHead: 'SUR', confidence: 0.9 })) } };

  it('a new shortage holds the case at claim preparation (BALANCE_REVIEW), with no AI call', async () => {
    const check = await recheckBalance(fields(items), info, memberResult, heads);
    expect(getMemberLimitBalance).toHaveBeenCalledTimes(1);
    expect(pickBenefit).not.toHaveBeenCalled(); // no AI call
    expect(check).toMatchObject({ checked: true, uncovered: ['2|IP|SUR|5000000'], hold: true });
  });

  it('a shortage a bypass covers goes on (the claim never goes STP)', async () => {
    const bypass = { kind: 'verdict', item: 'member:balance', corrected: true, coverKeys: ['2|IP|SUR|5000000'] };
    const check = await recheckBalance(fields(items, { corrections: [bypass] }), info, memberResult, heads);
    expect(check).toMatchObject({ uncovered: [], hold: false });
    expect(check.issue).not.toBeNull();
  });

  it('a shortage on a head chosen later at claim preparation holds too: the case waits where it is, never loops', async () => {
    const later = [heads[0], { benefitType: 'IP', benefitHead: 'ICU' }];
    const check = await recheckBalance(fields(items), info, memberResult, later);
    expect(check).toMatchObject({ hold: true });
  });
});

describe('second balance check: review fixes', () => {
  const { recheckBalance } = require('../modules/member-verification/memberBalance');
  const items = [surgeon(5000000), surgeon(5000000)];
  const heads = [{ benefitType: 'IP', benefitHead: 'SUR' }, { benefitType: 'IP', benefitHead: 'SUR' }];
  const basis = { typeOfPatient: 'Inpatient', plan: { planId: '2311', revNo: '01' } };
  const picks = items.map((item, i) => ({ voucher: i, key: { subtotal: item.subtotal, date: item.date, voucherType: item.voucher_type }, basis, benefitType: 'IP', benefitHead: 'SUR', confidence: 0.9 }));

  it('a whole-check override counts as letting the shortfall through: no hold', async () => {
    const overridden = { balance: { picks }, issues: [{ item: 'member:balance', coverKeys: ['2|IP|SUR|5000000'] }] };
    expect(await recheckBalance(fields(items), info, overridden, heads)).toMatchObject({ uncovered: [], hold: false });
  });

  it('every bypass counts, in both checks: a later bypass of another voucher keeps the earlier one', async () => {
    const old = { kind: 'verdict', item: 'member:balance', corrected: true, coverKeys: ['2|IP|SUR|5000000'] };
    const latest = { kind: 'verdict', item: 'member:balance', corrected: true, coverKeys: ['9|IP|SUR|1'] };
    const check = await recheckBalance(fields(items, { corrections: [old, latest] }), info, { balance: { picks } }, heads);
    expect(check.uncovered).toEqual([]);
    const issue = { item: 'member:balance', reasonCode: 'BALANCE_NOT_ENOUGH', reason: 'x', coverKeys: ['2|IP|SUR|5000000'] };
    expect(evaluate(fields([], { corrections: [{ ...old, covers: 'x' }, { ...latest, covers: 'y' }] }), info, [issue]).outcome).toBe('MEMBER_VERIFIED');
  });

  it('a held case with no heads to check with keeps waiting', async () => {
    const { heldBalanceEnough } = require('../modules/member-verification/memberBalance');
    expect(await heldBalanceEnough(fields(items), info, { balance: { picks } }, { lines: [] })).toBe(false);
    expect(getMemberLimitBalance).not.toHaveBeenCalled();
  });
});

describe('BALANCE_REVIEW: bypass goes back to claim preparation', () => {
  const { recheckFrom } = require('../modules/ai-feedback/corrections');
  it('a bypass at the balance stop goes back to claim preparation, never through the member check again', () => {
    expect(recheckFrom('member:balance', 'BALANCE_REVIEW')).toMatchObject({ EMAIL: 'DOCUMENTS_UPLOADED', label: 'claim preparation' });
    expect(recheckFrom('member:balance', 'API_BALANCE_REVIEW')).toMatchObject({ API: 'API_READY_FOR_CLAIM_PREPARATION' });
    expect(recheckFrom('member:balance', 'MEMBER_REVIEW_REQUIRED')).toMatchObject({ EMAIL: 'RECOGNIZED' });
  });
});
