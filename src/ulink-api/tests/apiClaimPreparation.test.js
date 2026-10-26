// api-claim-preparation: hands the earlier jobs' outputs to the email flow's own (unchanged) claim
// preparation, then turns its payload into the IAS claim revision body: claimNo, IAS's
// TpaCaseNumber, barcode + suppBarcode1-5, and the API flags (isValidation / isCSR / isSuspense).

// A reviewer's own lines (SYSTEM_4 E4-28): none open — no database here.
jest.mock('../modules/case-requests/requests', () => ({ ...jest.requireActual('../modules/case-requests/requests'), openRequests: jest.fn(async () => []) }));
jest.mock('../modules/ias-claim-preparation/service', () => ({ checkCase: jest.fn() }));
// Switches as the owner set them (claim preparation stop on); the stop's own tests set them per test.
jest.mock('../modules/settings/settings', () => ({ getSettings: jest.fn(async () => ({ holdUnsureDiagnosis: true, holdUnsureBenefit: true, aiConfidenceThreshold: 0.7 })) }));

const { checkCase } = require('../modules/ias-claim-preparation/service');
const { getSettings } = require('../modules/settings/settings');
const { job, barcodeFields, apiFlags } = require('../modules/api-claim-preparation/service');

const createdAt = new Date('2026-09-24T03:00:00Z');
const caseRecord = { id: 'case-1', createdAt, currentStatus: 'API_READY_FOR_CLAIM_PREPARATION' };
const extractedFields = { claim: { insurer_case_number: 'OCR-READ-NUMBER' } };
const inputWith = (documentCheck) => ({
  'api-claim-intake': { clNo: '2604050015', tpaCaseNumber: 'STEVENEVERHILLC58', crtDate: '2026-09-24T09:00:00' },
  'api-material-download': { documents: [
    { barcodeId: 'LATER', createdAt: '2026-09-24T05:00:00Z', documentIds: ['d2'] },
    { barcodeId: 'FIRST', createdAt: '2026-09-24T04:00:00Z', documentIds: ['d1'] },
  ] },
  'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields },
  'api-member-verification': { iasMemberInfoResponse: { success: true, payload: { member: {} } }, memberVerifyResult: { outcome: 'MEMBER_VERIFIED' } },
  'api-document-checking': documentCheck,
});
const passed = { outcome: 'DOCUMENT_CHECKED', checkedAt: '2026-09-24T06:00:00.000Z', documentCheckResult: { passed: true } };
const failed = { outcome: 'INCOMPLETE', checkedAt: '2026-09-24T06:00:00.000Z', documentCheckResult: { passed: false } };
const prepared = (isStp) => ({
  payload: { MemberRefNo: 'M1', TpaCaseNumber: 'OCR-READ-NUMBER', barcode: 'FIRST', isValidation: 'N', isCSR: 'N', Items: [{ PresentedAmt: 1000 }] },
  diagnosis: { diagCode: 'J06.9' },
  lines: [{ subtotal: 1000 }],
  isStp,
  claimPrepMeta: { lines: [] },
});

beforeEach(() => jest.clearAllMocks());

it('runs whether the documents passed or not (after api-console-upload), with every earlier output it needs', () => {
  expect(job).toMatchObject({
    inputStatus: ['API_READY_FOR_CLAIM_PREPARATION'],
    optionalInputs: ['case-override', 'api-console-barcode', 'preparation-review'],
    inputs: ['api-claim-intake', 'api-material-download', 'api-claim-recognition', 'api-member-verification', 'api-document-checking'],
  });
});

it("builds the email flow's payload from the earlier outputs, then the revision body", async () => {
  checkCase.mockResolvedValue(prepared(false));

  const result = await job.process({ caseRecord, input: inputWith(passed) });

  expect(checkCase).toHaveBeenCalledWith({
    id: 'case-1',
    // For the AI summary sent to IAS (AiSummaryRemark).
    claimNo: '2604050015',
    memberVerifyResult: { outcome: 'MEMBER_VERIFIED' },
    documentCheckResult: { passed: true },
    extractedFields,
    recognizedType: 'ayas_member_claim',
    iasMemberInfoResponse: { success: true, payload: { member: {} } },
    createdAt,
    consoleBarcode: 'FIRST',
    consoleUploadResult: { completedAt: expect.any(Date) },
    preparationChoice: null,
  });
  expect(result).toMatchObject({
    nextStatus: 'API_CLAIM_PAYLOAD_PREPARED',
    output: {
      documentsComplete: true,
      isStp: false,
      payload: {
        MemberRefNo: 'M1',
        claimNo: '2604050015',
        TpaCaseNumber: 'STEVENEVERHILLC58',
        barcode: 'FIRST',
        suppBarcode1: 'LATER',
        suppBarcode2: null,
        suppBarcode5: null,
        isValidation: 'N',
        isCSR: 'N',
        isSuspense: 'N',
      },
    },
  });
});

it('prepares a suspended revision when documents are missing, with the received date as the completion date', async () => {
  checkCase.mockResolvedValue(prepared(true)); // even an STP amount

  const result = await job.process({ caseRecord, input: inputWith(failed) });

  expect(checkCase.mock.calls[0][0].consoleUploadResult).toEqual({ completedAt: createdAt });
  expect(result.output).toMatchObject({ documentsComplete: false, payload: { isValidation: 'Y', isCSR: 'N', isSuspense: 'Y' } });
});

it("adds the case-page uploads' barcodes (api-console-barcode) after the console's own, by time", async () => {
  checkCase.mockResolvedValue(prepared(false));
  const input = { ...inputWith(passed), 'api-console-barcode': { barcodes: [{ barcodeId: 'OURS', scanId: 'API-STEVENEVERHILLC58-01', createdAt: '2026-09-25T01:00:00Z' }] } };
  const result = await job.process({ caseRecord, input });
  expect(result.output.payload).toMatchObject({ suppBarcode1: 'LATER', suppBarcode2: 'OURS', suppBarcode3: null });
});

describe('apiFlags (confirmed rules)', () => {
  it.each([
    ['STP, documents complete', { isStp: true, documentsComplete: true }, { isValidation: 'Y', isCSR: 'Y', isSuspense: 'N' }],
    ['non-STP, documents missing', { isStp: false, documentsComplete: false }, { isValidation: 'Y', isCSR: 'N', isSuspense: 'Y' }],
    ['non-STP, documents complete', { isStp: false, documentsComplete: true }, { isValidation: 'N', isCSR: 'N', isSuspense: 'N' }],
    ['STP, documents missing (suspense wins)', { isStp: true, documentsComplete: false }, { isValidation: 'Y', isCSR: 'N', isSuspense: 'Y' }],
  ])('%s', (_label, args, expected) => {
    expect(apiFlags(args)).toEqual(expected);
  });
});

describe('barcodeFields', () => {
  const docs = (n) => Array.from({ length: n }, (_, i) => ({ barcodeId: `B${i + 1}`, createdAt: `2026-09-24T0${i}:00:00Z` }));

  it('puts the earliest submission in barcode and the next five in suppBarcode1-5, null when unused', () => {
    expect(barcodeFields(docs(2))).toEqual({ barcode: 'B1', suppBarcode1: 'B2', suppBarcode2: null, suppBarcode3: null, suppBarcode4: null, suppBarcode5: null });
  });

  it('keeps only the first six', () => {
    expect(barcodeFields(docs(8))).toEqual({ barcode: 'B1', suppBarcode1: 'B2', suppBarcode2: 'B3', suppBarcode3: 'B4', suppBarcode4: 'B5', suppBarcode5: 'B6' });
  });

  it('has all slots null with no submissions', () => {
    expect(Object.values(barcodeFields([]))).toEqual([null, null, null, null, null, null]);
  });
});

// Contract check against the real IAS sample (docs/imp/demo/API DAY1/IAS_CLAIM_REVISION.md): the email
// flow's payload (unmocked builder) plus claimNo has every field of the revision body, and the only
// extras are the API fields added here (supplementary barcodes, isSuspense).
it('matches the IAS claim revision body, plus only the API fields', () => {
  const fs = require('fs');
  const path = require('path');
  const { buildPayload } = jest.requireActual('../modules/ias-claim-preparation/payloadBuilder');
  const md = fs.readFileSync(path.join(__dirname, '../../../docs/imp/demo/API DAY1/IAS_CLAIM_REVISION.md'), 'utf8');
  const sample = JSON.parse(md.slice(md.indexOf('{')));

  const payload = {
    ...buildPayload({
      extractedFields: { claim: {}, medical: {}, claimant: {}, policy: {} },
      iasMemberInfoResponse: { payload: { member: {}, memberPlans: [{}] } },
      route: null, diagnosis: null, lines: [{ subtotal: 1, benefit: null }],
      receivedAt: new Date(), barcode: 'B', isStp: false, docCompleteDate: new Date(),
    }),
    claimNo: 'x',
    ...barcodeFields([]),
    ...apiFlags({ isStp: false, documentsComplete: true }),
  };

  const extras = Object.keys(payload).filter((k) => !(k in sample)).sort();
  expect(Object.keys(sample).filter((k) => !(k in payload))).toEqual([]);
  expect(extras).toEqual(['isSuspense', 'suppBarcode1', 'suppBarcode2', 'suppBarcode3', 'suppBarcode4', 'suppBarcode5']);
  expect(Object.keys(payload.Items[0]).sort()).toEqual(Object.keys(sample.Items[0]).sort());
});

it("a reviewer's own line still open: the revision is suspended, even after an earlier override (SYSTEM_4 E4-28)", async () => {
  const { openRequests } = require('../modules/case-requests/requests');
  openRequests.mockResolvedValueOnce([{ id: 'r1', text: 'Need to fill treatment date in the eye test record' }]);
  checkCase.mockResolvedValue(prepared(false));
  const result = await job.process({ caseRecord, input: { ...inputWith(passed), 'case-override': { from: 'API_DOCUMENTS_REVIEW' } } });
  expect(result.output.payload.isSuspense).toBe('Y');
});

// The AI unsure of the diagnosis code or a voucher's benefit (owner, 2026-10-20): with the switch on, a person decides
// before the revision (API_PREPARATION_REVIEW).
describe('claim preparation stop', () => {
  const withDiagnosis = (diagnosis, lines = []) => ({ ...prepared(false), claimPrepMeta: { lines, diagnosis } });
  const settings = (holdUnsureDiagnosis, holdUnsureBenefit = false) => getSettings.mockResolvedValue({ holdUnsureDiagnosis, holdUnsureBenefit, aiConfidenceThreshold: 0.7 });

  it.each([
    ['the default code', { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0.4 }],
    ['at the threshold', { pick: { diagCode: 'K05.1' }, defaulted: false, confidence: 0.7 }],
  ])('switch on + %s: waits for a person', async (_label, diagnosis) => {
    settings(true);
    checkCase.mockResolvedValue(withDiagnosis(diagnosis));
    const result = await job.process({ caseRecord, input: inputWith(passed) });
    expect(result.nextStatus).toBe('API_PREPARATION_REVIEW');
    expect(result.output.claimPrepMeta.review).toEqual({ diagnosis: true, vouchers: [], rejections: [] });
  });

  it("a voucher with no head on a plan that has heads, or an unsure pick: stops, naming the voucher", async () => {
    settings(false, true);
    const plan = [{ type: 'DT', head: 'SCP' }, { type: 'OP', head: 'RX' }];
    const lines = [
      { pick: { benefitType: 'OP', benefitHead: 'RX' }, confidence: 0.9, candidates: plan },
      { pick: { benefitType: 'DT', benefitHead: null }, confidence: 0.9, candidates: plan },
      { pick: { benefitType: 'DT', benefitHead: 'SCP' }, confidence: 0.6, candidates: plan },
    ];
    checkCase.mockResolvedValue(withDiagnosis({ defaulted: false, confidence: 0.9 }, lines));
    const result = await job.process({ caseRecord, input: inputWith(passed) });
    expect(result.nextStatus).toBe('API_PREPARATION_REVIEW');
    expect(result.output.claimPrepMeta.review).toEqual({ diagnosis: false, vouchers: [1, 2], rejections: [] });
    expect(result.message).toMatch(/voucher 2, 3/);
  });

  it('switch off, the AI sure, or a person already chose: revision prepared', async () => {
    settings(false);
    checkCase.mockResolvedValue(withDiagnosis({ defaulted: true, confidence: 0.4 }));
    expect((await job.process({ caseRecord, input: inputWith(passed) })).nextStatus).toBe('API_CLAIM_PAYLOAD_PREPARED');

    settings(true);
    checkCase.mockResolvedValue(withDiagnosis({ defaulted: false, confidence: 0.71 }));
    expect((await job.process({ caseRecord, input: inputWith(passed) })).nextStatus).toBe('API_CLAIM_PAYLOAD_PREPARED');

    checkCase.mockResolvedValue(withDiagnosis({ defaulted: false, confidence: 0.4, chosen: { by: 'ulink', comment: 'gingivitis on the slip' } }));
    const choice = { diagnosis: { diagCode: 'K05.1', diagDesc: 'Chronic gingivitis', aiPick: { confidence: 0.4 } }, benefits: [], by: 'ulink', comment: 'gingivitis on the slip' };
    const result = await job.process({ caseRecord, input: { ...inputWith(passed), 'preparation-review': choice } });
    expect(checkCase.mock.calls.at(-1)[0].preparationChoice).toEqual(choice);
    expect(result.nextStatus).toBe('API_CLAIM_PAYLOAD_PREPARED');
  });
});
