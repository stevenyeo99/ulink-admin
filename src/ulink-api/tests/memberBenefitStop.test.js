// SYSTEM_5 member balance phase C: the member check stops for a person when the AI is unsure of a voucher's head
// (holdUnsureBenefit, both flows) — after member problems, before the balance is judged.
jest.mock('../modules/ias-claim-preparation/benefitPicker', () => ({ pickBenefit: jest.fn() }));
jest.mock('../modules/member-verification/iasClient', () => ({ getMemberLimitBalance: jest.fn(), getMemberInfo: jest.fn(), getMemberPolicyEvents: jest.fn(async () => ({ success: true, payload: { memberEvents: [], policyEvents: [] } })) }));
jest.mock('../modules/member-verification/exclusionFlags', () => ({ checkExclusions: jest.fn(async () => []) }));
// No check switched off (AI checklist switches) — no database here.
jest.mock('../modules/ai-checklist/switches', () => ({ switchedOff: jest.fn(async () => new Map()), offNote: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/medicalTranslation', () => ({ toEnglishMedicalText: jest.fn(async (t) => ({ ...t, translation: null })) }));
// The switches as last read: holdUnsureBenefit per test.
let mockHold = true;
jest.mock('../modules/settings/settings', () => {
  const actual = jest.requireActual('../modules/settings/settings');
  return { ...actual, lastReadSettings: () => ({ ...actual.DEFAULTS, holdUnsureBenefit: mockHold }) };
});

const { pickBenefit } = require('../modules/ias-claim-preparation/benefitPicker');
const { getMemberLimitBalance, getMemberInfo } = require('../modules/member-verification/iasClient');
const { checkCase } = require('../modules/member-verification/service');
const sample = require('./fixtures/memberBalance/ias-balance-sample.json');

const info = {
  success: true,
  payload: {
    member: { MBR_REF_NO: 'M1', DOB: '01011990' },
    policies: [{ POCY_REF_NO: 'P1', EFF_DATE: '09012025' }],
    memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030', plan: { PLAN_ID: '2311', REV_NO: '01' }, coverageLimits: [{ benefits: [{ benefit_type_code: 'IP', benefit_type_desc: 'Inpatient' }] }] }],
  },
};
const caseRecord = (items) => ({
  id: 'c1',
  extractedFields: {
    claim: { appointment_date: '2026-09-01', type_of_patient: 'Inpatient' },
    claimant: { claimant_nrc_passport: '12/ABC(N)1', claimant_dob: '1990-01-01' },
    invoices: { items },
  },
});
const voucher = (subtotal) => ({ subtotal, date: '2026-09-01', voucher_type: 'other' });

beforeEach(() => {
  jest.clearAllMocks();
  mockHold = true;
  getMemberInfo.mockResolvedValue(info);
  getMemberLimitBalance.mockResolvedValue(sample);
});

it('an unsure head stops at Choose the benefit, with the balance left unjudged', async () => {
  pickBenefit.mockResolvedValue({ pick: null, confidence: 0.2 });
  const { outcome, result } = await checkCase(caseRecord([voucher(99000000)]));
  expect(outcome).toBe('BENEFIT_REVIEW');
  expect(result).toMatchObject({ reasonCode: 'BENEFIT_UNSURE', reason: 'The AI was not sure of the benefit of voucher 1: a person chooses it.' });
  expect(result.balance.unsure).toEqual([0]);
});

it('with the switch off, the unsure voucher is checked at benefit type level and the balance decides', async () => {
  mockHold = false;
  pickBenefit.mockResolvedValue({ pick: null, confidence: 0.2 });
  const { outcome, result } = await checkCase(caseRecord([voucher(99000000)]));
  expect(outcome).toBe('MEMBER_REVIEW_REQUIRED');
  expect(result.reasonCode).toBe('BALANCE_NOT_ENOUGH');
});

it('a sure head goes straight to the balance', async () => {
  pickBenefit.mockResolvedValue({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.9 });
  expect((await checkCase(caseRecord([voucher(1000)]))).outcome).toBe('MEMBER_VERIFIED');
});

it('a member problem and a sure short voucher are raised together; the unsure voucher waits for its head', async () => {
  pickBenefit
    .mockResolvedValueOnce({ pick: { benefitType: 'IP', benefitHead: 'SUR' }, confidence: 0.9 })
    .mockResolvedValueOnce({ pick: null, confidence: 0.2 });
  const record = caseRecord([voucher(99000000), voucher(99000000)]);
  record.extractedFields.claimant.claimant_dob = '1980-01-01'; // a member problem: DOB differs from IAS
  const { outcome, result } = await checkCase(record);
  expect(outcome).toBe('MEMBER_REVIEW_REQUIRED');
  const balance = result.issues.find((i) => i.item === 'member:balance');
  expect(balance.coverKeys).toEqual(['1|IP|SUR|99000000']); // voucher 2 (unsure) left out
});

it('no benefit on the member plan to choose from: no stop', async () => {
  pickBenefit.mockResolvedValue({ pick: null, confidence: 0.2 });
  getMemberInfo.mockResolvedValue({ ...info, payload: { ...info.payload, memberPlans: [{ ...info.payload.memberPlans[0], coverageLimits: [] }] } });
  expect((await checkCase(caseRecord([voucher(1000)]))).outcome).not.toBe('BENEFIT_REVIEW');
});
