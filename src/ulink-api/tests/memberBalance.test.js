// SYSTEM_5 member balance, phase A: the balance rules (member-verification/balance.js) on the IAS spec sample.
const fs = require('fs');
const path = require('path');
const { balanceRequest, memberPlanKey, checkBalance, balanceLineText } = require('../modules/member-verification/balance');

// The response body of docs/imp/CR/SYSTEM_5/INTEGRATION/IAS_MEMBER_BALANCE_SPEC.md, copied as a fixture.
const sample = require('./fixtures/memberBalance/ias-balance-sample.json');
const plan = { planId: '2311', revNo: '01' };
const voucher = (n, amount, benefitType, benefitHead) => ({ voucher: n, amount, benefitType, benefitHead });

it('builds the request from the member info answer, and the plan to match', () => {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/imp/day1/IAS/ias_get_member_information_response_v2.json'), 'utf8'));
  // "01" and 1 are one revision.
  expect(memberPlanKey({ payload: { memberPlans: [{ plan: { PLAN_ID: 2311, REV_NO: 1 } }] } })).toEqual({ planId: '2311', revNo: '1' });
  expect(balanceRequest(info)).toEqual({ memberRefNo: '8/TATAKA(N)127934', policyRefNo: 'AYA/YGN/AYH/25000400', policyEffDate: '08012025' });
  expect(memberPlanKey(info)).toEqual({ planId: '2150', revNo: '01' });
  expect(balanceRequest({ payload: { member: {}, policies: [] } })).toBeNull();
});

it('takes the lowest balance among every covering limit: Outpatient 0 is used up', () => {
  // OP RX is covered by H RX 660,000, T OP 0, two CH (0 and 8,587,070) and CT 8,587,070.
  const { short, lines } = checkBalance(sample, plan, [voucher(1, 150000, 'OP', 'RX')]);
  expect(lines[0]).toMatchObject({ balanceLeft: 0, limit: 'T OP', enough: false });
  expect(short).toHaveLength(1);
  expect(balanceLineText(lines[0])).toBe('Voucher 1 (OP Outpatient / RX Prescribed Medicine): voucher 150,000, balance 0 (T OP), not enough');
});

it('adds up vouchers that share a limit: the second sees the balance left', () => {
  // IP SUR: H SUR 11,000,000, T IP 9,434,070, CH 8,587,070, CT 8,587,070 → 8,587,070 (a tie: the first in the IAS list, CT).
  const { lines, short } = checkBalance(sample, plan, [voucher(1, 5000000, 'IP', 'SUR'), voucher(2, 5000000, 'IP', 'SUR')]);
  expect(lines.map((l) => [l.balanceLeft, l.enough])).toEqual([[8587070, true], [3587070, false]]);
  expect(short.map((l) => l.voucher)).toEqual([2]);
  expect(balanceLineText(lines[0])).toBe('Voucher 1 (IP Inpatient / SUR Surgeon’s Fee): voucher 5,000,000, balance 8,587,070 (CT combined), enough');
  expect(balanceLineText(lines[1])).toBe('Voucher 2 (IP Inpatient / SUR Surgeon’s Fee): voucher 5,000,000, balance left 3,587,070 (CT combined), not enough');
});

it('compares every non-null balance field: a lifetime limit counts too', () => {
  // IP AID (HIV): H AID has amt_yr null and amt_life 7,500,000 — lower than the year balances.
  const { lines } = checkBalance(sample, plan, [voucher(1, 8000000, 'IP', 'AID')]);
  expect(lines[0]).toMatchObject({ balanceLeft: 7500000, limit: 'H AID, lifetime', enough: false });
});

it('a per-visit limit is compared with each voucher on its own, never added up', () => {
  const visit = { success: true, payload: { results: [{ plan_id: '1', rev_no: '01', limits: [
    { limit_type_code: 'H', benefits: [{ benefit_type_code: 'OP', benefit_head_code: 'OV' }], amt_vis: 50000, amt_yr: null },
  ] }] } };
  const { lines } = checkBalance(visit, { planId: '1', revNo: '01' }, [voucher(1, 40000, 'OP', 'OV'), voucher(2, 40000, 'OP', 'OV'), voucher(3, 60000, 'OP', 'OV')]);
  expect(lines.map((l) => l.enough)).toEqual([true, true, false]);
  expect(lines[2].limit).toBe('H OV, per visit');
});

it('a voucher with no head is checked against the type limits only', () => {
  // OP with no head: T OP 0 and CT 8,587,070 — not the head limits (H RX 660,000).
  const { lines } = checkBalance(sample, plan, [voucher(1, 10000, 'OP', null)]);
  expect(lines[0]).toMatchObject({ balanceLeft: 0, limit: 'T OP', enough: false });
  expect(balanceLineText(lines[0])).toBe('Voucher 1 (OP Outpatient): voucher 10,000, balance 0 (T OP), not enough');
});

it('null is no limit; no covering limit is enough; a voucher with no amount or type is not checked', () => {
  const { lines, short } = checkBalance(sample, plan, [voucher(1, 1000, 'XX', 'YY'), voucher(2, null, 'OP', 'RX'), voucher(3, 1000, null, null)]);
  expect(lines.map((l) => l.enough)).toEqual([true, null, null]);
  expect(short).toEqual([]);
  expect(balanceLineText(lines[0])).toBe('Voucher 1 (XX / YY): voucher 1,000, no limit, enough');
  expect(balanceLineText(lines[1])).toBe('Voucher 2 (OP Outpatient / RX Prescribed Medicine): no amount read, balance not checked');
});

it('uses only the entry with the member plan id and revision', () => {
  expect(checkBalance(sample, { planId: '2311', revNo: '02' }, [voucher(1, 1, 'OP', 'RX')])).toEqual({ planFound: false, lines: [], short: [] });
  expect(checkBalance(sample, null, [voucher(1, 1, 'OP', 'RX')]).planFound).toBe(false);
});

it('matches a plan revision written 1 or "01", and codes in any case', () => {
  const { planFound, lines } = checkBalance(sample, { planId: '2311', revNo: '1' }, [voucher(1, 150000, 'op', ' rx ')]);
  expect(planFound).toBe(true);
  expect(lines[0]).toMatchObject({ benefitHeadDesc: 'Prescribed Medicine', balanceLeft: 0 });
});

it('an amount that is not a number is not checked, and does not spoil the next voucher on the same limit', () => {
  const { lines, short } = checkBalance(sample, plan, [voucher(1, '150,000', 'IP', 'SUR'), voucher(2, 5000000, 'IP', 'SUR')]);
  expect(lines.map((l) => [l.enough, l.balanceLeft])).toEqual([[null, null], [true, 8587070]]);
  expect(short).toEqual([]);
});
