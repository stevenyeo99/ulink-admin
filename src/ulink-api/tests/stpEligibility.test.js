// STP rules (2026-09-29): per case type (EMAIL / API) + IAS benefit type + currency, plus a
// never-STP diagnosis prefix list. Every block comes back as a reason.

jest.mock('../db/models', () => ({ StpRule: { findAll: jest.fn() }, StpBlockedDiagnosis: { findAll: jest.fn() }, StpBlockedBenefit: { findAll: jest.fn() } }));

const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');

const rule = (caseSource, benefitType, stpAllowed, amountLimit) => ({ caseSource, benefitType, currency: 'MMK', stpAllowed, amountLimit });
const config = {
  rules: [
    rule('EMAIL', 'OP', true, '50000'),
    rule('EMAIL', 'IP', false, null),
    rule('EMAIL', 'VS', true, '30000'),
    rule('API', 'OP', true, '100000'),
  ],
  blockedDiagnoses: [{ codePrefix: 'R69', note: 'not found' }, { codePrefix: 'c', note: null }],
};
const decide = (input) => evaluateStp(config, { source: 'EMAIL', currency: 'MMK', diagCode: 'J06.9', ...input });

it('is STP when every benefit type is allowed and within its own limit', () => {
  const result = decide({ lines: [{ benefitType: 'OP', subtotal: 30000 }, { benefitType: 'OP', subtotal: 20000 }, { benefitType: 'VS', subtotal: 30000 }] });
  expect(result).toMatchObject({ isStp: true, reasons: [] });
  expect(result.benefits).toEqual([
    { benefitType: 'OP', total: 50000, allowed: true, limit: 50000 },
    { benefitType: 'VS', total: 30000, allowed: true, limit: 30000 },
  ]);
});

it('uses the rules of the case type', () => {
  const lines = [{ benefitType: 'OP', subtotal: 80000 }];
  expect(decide({ lines }).reasons).toEqual(['OP 80,000 MMK > limit 50,000.']);
  expect(decide({ source: 'API', lines }).isStp).toBe(true);
});

it('blocks a type not allowed, a type with no rule, and a line with no benefit type', () => {
  expect(decide({ lines: [{ benefitType: 'IP', subtotal: 1 }] }).reasons).toEqual(['IP is not allowed for STP.']);
  expect(decide({ lines: [{ benefitType: 'DT', subtotal: 1 }] }).reasons).toEqual(['No STP rule for DT in MMK.']);
  expect(decide({ lines: [{ benefitType: null, subtotal: 1 }] }).reasons).toEqual(['A voucher has no benefit type, so no STP rule applies.']);
  expect(decide({ lines: [] }).isStp).toBe(false);
});

it('blocks a diagnosis on the never-STP list by code prefix, any case', () => {
  const lines = [{ benefitType: 'OP', subtotal: 1 }];
  expect(decide({ lines, diagCode: 'R69' }).reasons).toEqual(['Diagnosis R69 is on the never-STP list (R69: not found).']);
  expect(decide({ lines, diagCode: 'C50.9' }).isStp).toBe(false);
  expect(decide({ lines, diagCode: 'J06.9' }).isStp).toBe(true);
});

it('blocks a voucher whose benefit head is on the never-STP list, while the type rule still decides the rest', () => {
  const blocking = { ...config, blockedBenefits: [{ benefitType: 'OP', benefitHead: 'VACC', note: 'Vaccination: a person approves' }] };
  const run = (lines) => evaluateStp(blocking, { source: 'EMAIL', currency: 'MMK', diagCode: 'J06.9', lines });
  expect(run([{ benefitType: 'OP', benefitHead: 'CONS', subtotal: 30000 }]).isStp).toBe(true);
  expect(run([{ benefitType: 'OP', benefitHead: 'Vacc', subtotal: 1 }]).reasons).toEqual(['Voucher 1 is OP/Vacc, which is on the never-STP list (Vaccination: a person approves).']); // a head as typed
  const result = run([{ benefitType: 'OP', benefitHead: 'CONS', subtotal: 30000 }, { benefitType: 'OP', benefitHead: 'VACC', subtotal: 10000 }]);
  expect(result.reasons).toEqual(['Voucher 2 is OP/VACC, which is on the never-STP list (Vaccination: a person approves).']);
  expect(result.benefits).toEqual([{ benefitType: 'OP', total: 40000, allowed: true, limit: 50000 }]);
});

it("a code taken from the doctor's note does not block STP, but the result says so (UAT AYA-CL-26035164)", () => {
  const lines = [{ benefitType: 'OP', subtotal: 1000 }];
  expect(decide({ lines, diagCode: 'R50.9', diagnosisFromMedicalRecord: true })).toMatchObject({
    isStp: true,
    reasons: [],
    notes: ["Diagnosis R50.9 was taken from the doctor's note, because the claim form's diagnosis gave no match."],
  });
  expect(decide({ lines, diagCode: 'R50.9' }).notes).toEqual([]);
});
