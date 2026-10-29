// The diagnosis code from the claim's benefit (owner, 2026-10-29): dental Z01.2, vision Z46.0, vaccination Z24, prenatal
// Z34, delivery O80 or O82. The ICD-10 list and the AI are replaced here.

jest.mock('../modules/icd10/lookup', () => ({ findByCode: jest.fn(), findCandidates: jest.fn() }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));

const { findByCode } = require('../modules/icd10/lookup');
const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { diagnosisRule } = require('../modules/ias-claim-preparation/diagnosisRules');
const { pickRuledDiagnosis } = require('../modules/ias-claim-preparation/diagnosisPicker');

const IAS = { 'Z01.2': 'Dental examination', O80: 'Single spontaneous delivery', O82: 'Single delivery by caesarean section', Z24: 'Need for immunisation' };
const sure = (benefitType, benefitHead) => ({ pick: { benefitType, benefitHead }, confidence: 0.9, candidates: [] });
const labelOf = (lines) => diagnosisRule(lines, 0.7)?.label ?? null;

beforeEach(() => {
  jest.clearAllMocks();
  findByCode.mockImplementation(async (code) => (IAS[code] ? { diagCode: code, diagDesc: IAS[code] } : null));
});

it('names the rule for each kind of care, a head rule before the type alone', () => {
  expect(labelOf([sure('DT', 'SCP')])).toBe('Dental');
  expect(labelOf([sure('VS', 'SPEC')])).toBe('Vision');
  expect(labelOf([sure('OP', 'VACC')])).toBe('Vaccination');
  expect(labelOf([sure('IP', 'MAT')])).toBe('Maternity, prenatal');
  expect(labelOf([sure('MAT', 'NDEL')])).toBe('Maternity, delivery');
  expect(labelOf([sure('OP', 'OV')])).toBeNull(); // OP alone has no rule
  expect(labelOf([sure('IP', 'RB')])).toBeNull();
});

it('one matching voucher decides; vouchers of different rules, or an unsure benefit, give none', () => {
  expect(labelOf([sure('OP', 'VACC'), sure('OP', 'OV')])).toBe('Vaccination'); // a vaccine and a doctor's visit
  expect(labelOf([sure('DT', 'SCP'), sure('VS', 'SPEC')])).toBeNull();
  expect(labelOf([{ ...sure('DT', 'SCP'), confidence: 0.4 }])).toBeNull();
  expect(labelOf([{ ...sure('DT', 'SCP'), confidence: 0.4, chosen: { by: 'ulink' } }])).toBe('Dental'); // a person's choice is decided
});

it('one code: set from the IAS list without the AI; missing from the list: null', async () => {
  const dental = await pickRuledDiagnosis(diagnosisRule([sure('DT', 'SCP')], 0.7), 'Treatment: scaling');
  expect(dental).toMatchObject({ pick: { diagCode: 'Z01.2', diagDesc: 'Dental examination' }, defaulted: false, rule: { label: 'Dental', set: true } });
  expect(synthesizeJson).not.toHaveBeenCalled();
  expect(await pickRuledDiagnosis(diagnosisRule([sure('VS', 'SPEC')], 0.7), 'glasses')).toBeNull(); // Z46.0 not in this list
});

it('delivery: the AI picks only O80 or O82, with the hint and the claim benefits; unsure falls back to the default', async () => {
  synthesizeJson.mockResolvedValueOnce({ diagCode: 'O82', diagDesc: 'Single delivery by caesarean section', confidence: 0.9, reason: 'LSCS' });
  const rule = diagnosisRule([sure('MAT', 'NDEL'), sure('IP', 'OPR')], 0.7);
  const result = await pickRuledDiagnosis(rule, 'Diagnosis/illness: LSCS', { benefits: ['MAT/NDEL', 'IP/OPR'] });

  const { userText } = synthesizeJson.mock.calls[0][0];
  expect(userText).toMatch(/Benefits on this claim: MAT\/NDEL, IP\/OPR/);
  expect(userText).toMatch(/ULINK rule for Maternity, delivery: pick only one of these codes/);
  expect(userText).toMatch(/- O80: Single spontaneous delivery\n- O82: Single delivery by caesarean section/);
  expect(result).toMatchObject({ pick: { diagCode: 'O82' }, defaulted: false, rule: { label: 'Maternity, delivery' } });
  expect(result.rule.set).toBeUndefined(); // the AI's pick: a person decides when it is unsure

  synthesizeJson.mockResolvedValueOnce({ diagCode: null, diagDesc: null, confidence: 0.2, reason: 'only "delivery"' });
  expect(await pickRuledDiagnosis(rule, 'Diagnosis/illness: delivery', { benefits: ['MAT/NDEL'] })).toMatchObject({ defaulted: true });
});
