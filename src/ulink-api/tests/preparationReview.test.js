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
  mainDiagnosisTerm: jest.fn(async () => 'fever'),
  hasBurmese: jest.requireActual('../modules/ias-claim-preparation/medicalTranslation').hasBurmese,
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

// The claim form gave no code (R69): the doctor's note is tried next (UAT AYA-CL-26035164 — the form said "ဓမ္မတာ",
// the note said fever). The claim form stays first; a sure code from the note can go STP (owner 2026-11-11), an unsure
// one waits for a person.
describe("diagnosis from the doctor's note", () => {
  const { stpDecision } = require('../modules/ias-claim-preparation/stpEligibility');
  const { mainDiagnosisTerm } = require('../modules/ias-claim-preparation/medicalTranslation');
  const R69 = { pick: { diagCode: 'R69', diagDesc: 'Unknown' }, defaulted: true, confidence: 0.1, candidates: [] };
  const FEVER = { pick: { diagCode: 'R50.9', diagDesc: 'Fever, unspecified' }, defaulted: false, confidence: 0.9, candidates: [] };
  const withNote = (note) => ({
    ...caseRecord,
    preparationChoice: null,
    extractedFields: {
      ...caseRecord.extractedFields,
      medical: { detail_of_illness_injury: 'ဓမ္မတာ', full_description_of_treatment: 'ဓမ္မတာ' },
      medical_record: { present: true, diagnosis_or_treatment: note },
    },
  });
  const diagnosisLine = (meta) => buildAssessmentSummary({ source: 'API', claimPrepMeta: meta }).lines.find((l) => l.decision === 'Diagnosis code');

  it('the claim form gives R69: the code comes from the note; sure, it does not stop the case, and says where it came from', async () => {
    pickDiagnosis.mockResolvedValueOnce(R69).mockResolvedValueOnce(FEVER);

    const prepared = await checkCase(withNote('c/o fever x 1 day'));

    expect(mainDiagnosisTerm).toHaveBeenCalledWith('c/o fever x 1 day');
    expect(pickDiagnosis).toHaveBeenLastCalledWith("Doctor's note: c/o fever x 1 day\nMain diagnosis or symptom: fever", { searchText: 'fever' });
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'R50.9', DiagnosisDescription: 'fever' });
    expect(prepared.claimPrepMeta.diagnosis).toMatchObject({ fromMedicalRecord: { searchedAs: 'fever' }, doctorNote: 'c/o fever x 1 day' });
    expect(diagnosisUnsure(prepared.claimPrepMeta.diagnosis, 0.7)).toBe(false);
    expect(stpDecision).toHaveBeenCalledWith(expect.objectContaining({ diagCode: 'R50.9', diagnosisFromMedicalRecord: true }));
    const line = diagnosisLine(prepared.claimPrepMeta);
    expect(line.why).toContain('Code from the doctor\'s note (searched as "fever"), because the claim form\'s illness "ဓမ္မတာ" gave no match.');
    expect(line.why).toContain('Doctor\'s note says: "c/o fever x 1 day"');
    expect(line).toMatchObject({ status: 'ok', review: null });
  });

  it('an unsure code from the note waits for a person', async () => {
    pickDiagnosis.mockResolvedValueOnce(R69).mockResolvedValueOnce({ ...FEVER, confidence: 0.6 });
    const prepared = await checkCase(withNote('c/o fever x 1 day'));
    expect(prepared.claimPrepMeta.diagnosis.fromMedicalRecord).toBeTruthy();
    expect(diagnosisUnsure(prepared.claimPrepMeta.diagnosis, 0.7)).toBe(true);
  });

  it("the IAS description is the note's own term, from the AI per case, not a fixed word", async () => {
    pickDiagnosis.mockResolvedValueOnce(R69).mockResolvedValueOnce({ ...FEVER, pick: { diagCode: 'A09.9', diagDesc: 'Gastroenteritis' } });
    mainDiagnosisTerm.mockResolvedValueOnce('gastroenteritis');
    const prepared = await checkCase(withNote('Gastroenteritis'));
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'A09.9', DiagnosisDescription: 'gastroenteritis' });
  });

  it('a Burmese note: the pick sees only its English term', async () => {
    pickDiagnosis.mockResolvedValueOnce(R69).mockResolvedValueOnce(FEVER);
    await checkCase(withNote('ဖျား'));
    expect(pickDiagnosis).toHaveBeenLastCalledWith('Main diagnosis or symptom: fever', { searchText: 'fever' });
  });

  it('the note names no diagnosis or symptom: R69 stays, no code search', async () => {
    pickDiagnosis.mockResolvedValue(R69);
    mainDiagnosisTerm.mockResolvedValueOnce(null);
    const prepared = await checkCase(withNote('Paracetamol 5mg'));
    expect(pickDiagnosis).toHaveBeenCalledTimes(1);
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'R69' });
  });

  it('no fallback when the note is not the medical record, or under a ULINK rule; an AI failure keeps R69', async () => {
    pickDiagnosis.mockResolvedValue(R69);
    const notRecord = withNote('fever');
    notRecord.extractedFields.medical_record.present = false;
    await checkCase(notRecord);
    expect(pickDiagnosis).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    pickRuledDiagnosis.mockResolvedValueOnce({ ...R69, rule: { label: 'MAT/NDEL', codes: ['O80', 'O82'] } });
    await checkCase(withNote('fever'));
    expect(pickDiagnosis).not.toHaveBeenCalled();
    pickRuledDiagnosis.mockReset();

    jest.clearAllMocks();
    pickDiagnosis.mockResolvedValueOnce(R69).mockRejectedValueOnce(new Error('LM Studio timeout'));
    const prepared = await checkCase(withNote('fever'));
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'R69' });

    jest.clearAllMocks();
    pickDiagnosis.mockResolvedValue(R69);
    mainDiagnosisTerm.mockRejectedValueOnce(new Error('LM Studio timeout'));
    expect((await checkCase(withNote('fever'))).payload.Items[0]).toMatchObject({ DiagnosisCode: 'R69' });
  });

  it('the note gives no match either: R69 stays, as today', async () => {
    pickDiagnosis.mockResolvedValue(R69);
    const prepared = await checkCase(withNote('6 faa x 1day'));
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'R69', DiagnosisDescription: 'ဓမ္မတာ' });
    expect(prepared.claimPrepMeta.diagnosis.fromMedicalRecord).toBeUndefined();
    expect(diagnosisLine(prepared.claimPrepMeta).why).toContain('Doctor\'s note says: "6 faa x 1day"');
  });

  it('a clear claim form diagnosis: the note is not asked, only shown', async () => {
    pickDiagnosis.mockResolvedValue({ pick: { diagCode: 'K02.9', diagDesc: 'Dental caries' }, defaulted: false, confidence: 0.9, candidates: [] });
    const clear = withNote('fever');
    clear.extractedFields.medical = { detail_of_illness_injury: 'Toothache', full_description_of_treatment: 'filling' };

    const prepared = await checkCase(clear);

    expect(pickDiagnosis).toHaveBeenCalledTimes(1);
    expect(mainDiagnosisTerm).not.toHaveBeenCalled();
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'K02.9' });
    expect(stpDecision).toHaveBeenCalledWith(expect.objectContaining({ diagnosisFromMedicalRecord: false }));
  });

  it("a person's code wins over the note's, and STP is open again", async () => {
    const chose = withNote('c/o fever x 1 day');
    chose.preparationChoice = {
      ...caseRecord.preparationChoice,
      diagnosis: { diagCode: 'R50.9', diagDesc: 'Fever, unspecified', source: 'ဓမ္မတာ\nဓမ္မတာ', aiPick: { ...FEVER, fromMedicalRecord: { searchedAs: 'fever' } } },
    };

    const prepared = await checkCase(chose);

    expect(pickDiagnosis).not.toHaveBeenCalled();
    expect(prepared.payload.Items[0]).toMatchObject({ DiagnosisCode: 'R50.9', DiagnosisDescription: 'ဓမ္မတာ' });
    expect(diagnosisUnsure(prepared.claimPrepMeta.diagnosis, 0.7)).toBe(false);
    expect(stpDecision).toHaveBeenCalledWith(expect.objectContaining({ diagnosisFromMedicalRecord: false }));
  });
});
