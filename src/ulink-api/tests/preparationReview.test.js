// A person decided at the claim preparation stop (owner, 2026-10-20: API_PREPARATION_REVIEW): claim preparation uses
// the chosen diagnosis code and voucher benefits and does not ask the AI for them again; the assessment says a person
// chose them, not "AI unsure". A changed text or voucher gets a new AI pick.
jest.mock('../db/models', () => ({
  ClaimRoute: { findOne: jest.fn().mockResolvedValue(null) },
  CaseEvent: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../modules/ias-claim-preparation/diagnosisPicker', () => ({ pickDiagnosis: jest.fn(), pickRuledDiagnosis: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/benefitPicker', () => ({
  pickBenefit: jest.fn().mockResolvedValue({ pick: { benefitType: 'DT', benefitHead: 'SCP' }, confidence: 0.9, reason: 'dental' }),
}));
jest.mock('../modules/ias-claim-preparation/medicalTranslation', () => ({
  toEnglishMedicalText: jest.fn(async ({ diagnosis, treatment }) => ({ diagnosis, treatment, translation: null })),
}));
jest.mock('../modules/ias-claim-preparation/stpEligibility', () => ({ stpDecision: jest.fn().mockResolvedValue({ isStp: false, reasons: [] }) }));
jest.mock('../modules/ias-claim-preparation/aiSummaryRemark', () => ({ aiSummaryRemark: jest.fn(() => 'remark') }));

const { pickDiagnosis, pickRuledDiagnosis } = require('../modules/ias-claim-preparation/diagnosisPicker');
const { diagnosisUnsure } = require('../modules/ias-claim-preparation/preparationReview');
const { pickBenefit } = require('../modules/ias-claim-preparation/benefitPicker');
const { checkCase } = require('../modules/ias-claim-preparation/service');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');

beforeEach(() => jest.clearAllMocks());

const caseRecord = {
  id: 'case-1',
  source: 'API',
  createdAt: new Date('2026-10-20T03:35:00Z'),
  extractedFields: {
    claim: { type_of_patient: 'dental care', total_claim_amount: 80000 },
    medical: { detail_of_illness_injury: 'Toothache', full_description_of_treatment: 'Ultrasonic scaling GI filling' },
    claimant: {},
    policy: {},
    invoices: { items: [{ subtotal: 80000, voucher_type: 'consultation' }] },
  },
  iasMemberInfoResponse: { payload: { member: {}, memberPlans: [{}] } },
  preparationChoice: {
    diagnosis: {
      diagCode: 'K05.1',
      diagDesc: 'Chronic gingivitis',
      text: 'Diagnosis/illness: Toothache\nTreatment: Ultrasonic scaling GI filling', // what the AI searched with
      aiPick: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0.4, reason: 'Toothache is a symptom', candidates: [] },
    },
    benefits: [],
    by: 'ulink',
    comment: 'The dental slip says chronic gingivitis',
  },
};

it("uses the person's code, without asking the AI, and says so in the assessment", async () => {
  const prepared = await checkCase(caseRecord);

  expect(pickDiagnosis).not.toHaveBeenCalled();
  expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'K05.1' });
  expect(prepared.claimPrepMeta.diagnosis).toMatchObject({
    pick: { diagCode: 'K05.1', diagDesc: 'Chronic gingivitis' },
    defaulted: false,
    confidence: 0.4, // the AI's own pick stays alongside
    chosen: { by: 'ulink', comment: 'The dental slip says chronic gingivitis' },
  });

  const line = buildAssessmentSummary({ source: 'API', claimPrepMeta: prepared.claimPrepMeta }).lines.find((l) => l.decision === 'Diagnosis code');
  expect(line).toMatchObject({ result: 'K05.1 Chronic gingivitis', status: 'ok', verified: 'Corrected by a person', review: null });
});

it('asks the AI again when the diagnosis text changed since the person chose (new documents or a correction)', async () => {
  pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K02.9', diagDesc: 'Dental caries, unspecified' }, defaulted: false, confidence: 0.9, candidates: [] });
  const changed = { ...caseRecord, extractedFields: { ...caseRecord.extractedFields, medical: { detail_of_illness_injury: 'Tooth decay', full_description_of_treatment: 'GI filling' } } };

  const prepared = await checkCase(changed);

  expect(pickDiagnosis).toHaveBeenCalled();
  expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'K02.9' });
  expect(prepared.claimPrepMeta.diagnosis.chosen).toBeUndefined();
});

it("keeps the person's code when the AI words the translation differently on the next run (case 401bce9c loop)", async () => {
  const { toEnglishMedicalText } = require('../modules/ias-claim-preparation/medicalTranslation');
  toEnglishMedicalText.mockResolvedValueOnce({ diagnosis: 'Itching', treatment: 'medication prescribed for low immunity', translation: 'my' });
  const saved = { ...caseRecord.preparationChoice.diagnosis, text: 'Diagnosis/illness: Itching\nTreatment: prescribed medication for decreased immunity', source: 'Toothache\nUltrasonic scaling GI filling' };

  const prepared = await checkCase({ ...caseRecord, preparationChoice: { ...caseRecord.preparationChoice, diagnosis: saved } });

  expect(pickDiagnosis).not.toHaveBeenCalled();
  expect(prepared.claimPrepMeta.diagnosis).toMatchObject({ pick: { diagCode: 'K05.1' }, source: 'Toothache\nUltrasonic scaling GI filling' });
});

// Vouchers on one claim may have different benefit types (owner, 2026-10-20) — each its own choice.
describe('chosen benefits', () => {
  const items = [{ subtotal: 30000, date: '2026-10-02', voucher_type: 'consultation' }, { subtotal: 50000, date: '2026-10-02', voucher_type: 'pharmacy' }];
  const twoVouchers = (benefits) => ({
    ...caseRecord,
    extractedFields: { ...caseRecord.extractedFields, invoices: { items } },
    preparationChoice: { diagnosis: null, benefits, by: 'ulink', comment: 'per the plan' },
  });
  const choice = (voucher, benefitType, benefitHead, item = items[voucher]) => ({
    voucher, key: { subtotal: item.subtotal, date: item.date, voucherType: item.voucher_type }, benefitType, benefitHead, aiPick: { pick: null, confidence: 0.3 },
  });

  it('each voucher keeps its own chosen type and head — a mixed DT / OP claim — and the AI is not asked for them', async () => {
    pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K05.1', diagDesc: 'Chronic gingivitis' }, defaulted: false, confidence: 0.9, candidates: [] });
    const prepared = await checkCase(twoVouchers([choice(0, 'DT', 'SCP'), choice(1, 'OP', 'RX')]));

    expect(pickBenefit).not.toHaveBeenCalled();
    expect(prepared.payload.Items.map((i) => [i.BenefitType, i.BenefitHead])).toEqual([['DT', 'SCP'], ['OP', 'RX']]);
    expect(prepared.claimPrepMeta.lines[1]).toMatchObject({ pick: { benefitType: 'OP', benefitHead: 'RX' }, confidence: 0.3, chosen: { by: 'ulink' } });
    const line = buildAssessmentSummary({ source: 'API', claimPrepMeta: prepared.claimPrepMeta }).lines.find((l) => l.decision.startsWith('Benefit (voucher 2'));
    expect(line).toMatchObject({ result: 'OP/RX', status: 'ok', verified: 'Corrected by a person' });
  });

  it('a voucher that changed since the choice (new documents) gets a new AI pick; the other keeps its choice', async () => {
    pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K05.1', diagDesc: 'Chronic gingivitis' }, defaulted: false, confidence: 0.9, candidates: [] });
    const stale = choice(1, 'OP', 'RX', { ...items[1], subtotal: 45000 });
    const prepared = await checkCase(twoVouchers([choice(0, 'DT', 'SCP'), stale]));

    expect(pickBenefit).toHaveBeenCalledTimes(1);
    expect(prepared.payload.Items.map((i) => i.BenefitType)).toEqual(['DT', 'DT']); // voucher 2: the AI's DT/SCP (mocked)
    expect(prepared.claimPrepMeta.lines[1].chosen).toBeUndefined();
  });
});

describe('manual rejections (vitamins / supplements)', () => {
  const { reviewNeeded } = require('../modules/ias-claim-preparation/preparationReview');
  const items = [
    { subtotal: 16920, date: '2026-09-24', voucher_type: 'pharmacy', has_vitamin_or_supplement: false, vitamin_confidence: 1 },
    { subtotal: 60200, date: '2026-09-26', voucher_type: 'pharmacy', has_vitamin_or_supplement: true, vitamin_confidence: 0.5, vitamin_items: [{ name: 'Chewy Vitamin C', amount: 11000 }] },
  ];
  const withRejections = (rejections) => ({
    ...caseRecord,
    extractedFields: { ...caseRecord.extractedFields, invoices: { items } },
    preparationChoice: { diagnosis: null, benefits: [], rejections, by: 'ulink', comment: 'checked the bill' },
  });
  const key = (item) => ({ subtotal: item.subtotal, date: item.date, voucherType: item.voucher_type });
  const settings = { holdUnsureVitamin: true, aiConfidenceThreshold: 0.7 };
  beforeEach(() => pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K05.1', diagDesc: 'Chronic gingivitis' }, defaulted: false, confidence: 0.9, candidates: [] }));

  it('the AI unsure of a voucher\'s vitamins: the stop names that voucher (switch on only)', async () => {
    const prepared = await checkCase(withRejections([]));
    expect(prepared.payload.Items[1]).toMatchObject({ man_rej_amt_1: 11000 });
    expect(reviewNeeded(prepared.claimPrepMeta, settings)).toEqual({ diagnosis: false, vouchers: [], rejections: [1] });
    expect(reviewNeeded(prepared.claimPrepMeta, { ...settings, holdUnsureVitamin: false })).toBeNull();
  });

  it("a person's rejections win: added on a voucher the AI missed, removed on another; the assessment says who", async () => {
    const prepared = await checkCase(withRejections([
      { voucher: 0, key: key(items[0]), amount: 6000, remark: 'Superkids Z - 6,000 MMK is not covered due to supplement.' },
      { voucher: 1, key: key(items[1]), amount: null, remark: null },
    ]));
    expect(prepared.payload.Items[0]).toMatchObject({ man_rej_amt_1: 6000, man_rej_remark_1: 'Superkids Z - 6,000 MMK is not covered due to supplement.' });
    expect(Object.keys(prepared.payload.Items[1]).filter((k) => k.includes('man_rej'))).toEqual([]);
    expect(reviewNeeded(prepared.claimPrepMeta, settings)).toBeNull();
    const line = buildAssessmentSummary({ source: 'API', claimPrepMeta: prepared.claimPrepMeta }).lines.find((l) => l.decision === 'Manual rejection (voucher 1)');
    expect(line).toMatchObject({ result: '6,000 MMK', verified: 'Corrected by a person' });
  });
});

describe('diagnosis rule from the benefit (owner, 2026-10-29)', () => {
  const noChoice = { ...caseRecord, preparationChoice: null };
  const dental = { pick: { diagCode: 'Z01.2', diagDesc: 'Dental examination' }, defaulted: false, confidence: null, reason: 'Set from the benefit Dental (ULINK rule).', candidates: [], rule: { label: 'Dental', codes: ['Z01.2'], set: true } };

  it('a dental claim gets the rule code, not the AI search, and the code does not stop the case', async () => {
    pickRuledDiagnosis.mockResolvedValue(dental);
    const prepared = await checkCase(noChoice);

    expect(pickRuledDiagnosis).toHaveBeenCalledWith(expect.objectContaining({ label: 'Dental' }), expect.any(String), { benefits: ['DT/SCP'] });
    expect(pickDiagnosis).not.toHaveBeenCalled();
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'Z01.2' });
    expect(diagnosisUnsure(prepared.claimPrepMeta.diagnosis, 0.7)).toBe(false);
    const line = buildAssessmentSummary({ ...noChoice, claimPrepMeta: prepared.claimPrepMeta }).lines.find((l) => l.decision === 'Diagnosis code');
    expect(line).toMatchObject({ status: 'ok', verified: 'Rule', why: 'Set from the benefit Dental (ULINK rule).' });
  });

  it("a person's code wins over the rule", async () => {
    const prepared = await checkCase(caseRecord);
    expect(pickRuledDiagnosis).not.toHaveBeenCalled();
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'K05.1' });
  });

  it('an unsure benefit sets no code: the AI picks as for any claim', async () => {
    pickBenefit.mockResolvedValueOnce({ pick: { benefitType: 'DT', benefitHead: 'SCP' }, confidence: 0.3, reason: 'maybe dental' });
    pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K02.9', diagDesc: 'Dental caries' }, defaulted: false, confidence: 0.9, candidates: [] });
    await checkCase(noChoice);
    expect(pickRuledDiagnosis).not.toHaveBeenCalled();
    expect(pickDiagnosis).toHaveBeenCalled();
  });

  it('the rule code missing from the IAS list: the AI picks as for any claim', async () => {
    pickRuledDiagnosis.mockResolvedValue(null);
    pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K02.9', diagDesc: 'Dental caries' }, defaulted: false, confidence: 0.9, candidates: [] });
    const prepared = await checkCase(noChoice);
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'K02.9' });
  });
});
