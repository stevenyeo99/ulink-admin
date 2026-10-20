// A person chose the diagnosis code (owner, 2026-10-20: API_DIAGNOSIS_REVIEW): claim preparation uses it and does not
// ask the AI again; the assessment says a person chose it, not "AI unsure".
jest.mock('../db/models', () => ({
  ClaimRoute: { findOne: jest.fn().mockResolvedValue(null) },
  CaseEvent: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../modules/ias-claim-preparation/diagnosisPicker', () => ({ pickDiagnosis: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/benefitPicker', () => ({
  pickBenefit: jest.fn().mockResolvedValue({ pick: { benefitType: 'DT', benefitHead: 'SCP' }, confidence: 0.9, reason: 'dental' }),
}));
jest.mock('../modules/ias-claim-preparation/medicalTranslation', () => ({
  toEnglishMedicalText: jest.fn(async ({ diagnosis, treatment }) => ({ diagnosis, treatment, translation: null })),
}));
jest.mock('../modules/ias-claim-preparation/stpEligibility', () => ({ stpDecision: jest.fn().mockResolvedValue({ isStp: false, reasons: [] }) }));
jest.mock('../modules/ias-claim-preparation/aiSummaryRemark', () => ({ aiSummaryRemark: jest.fn(() => 'remark') }));

const { pickDiagnosis } = require('../modules/ias-claim-preparation/diagnosisPicker');
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
  diagnosisChoice: {
    diagCode: 'K05.1',
    diagDesc: 'Chronic gingivitis',
    text: 'Diagnosis/illness: Toothache\nTreatment: Ultrasonic scaling GI filling', // what the AI searched with
    aiPick: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0.4, reason: 'Toothache is a symptom', candidates: [] },
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
