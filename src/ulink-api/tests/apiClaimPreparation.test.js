// api-claim-preparation: hands the earlier jobs' outputs to the email flow's own (unchanged) claim
// preparation, then turns its payload into the IAS claim revision body: claimNo, IAS's
// TpaCaseNumber, barcode + suppBarcode1-5, and the API flags (isValidation / isCSR / isSuspense).

jest.mock('../modules/ias-claim-preparation/service', () => ({ checkCase: jest.fn() }));

const { checkCase } = require('../modules/ias-claim-preparation/service');
const { job, barcodeFields, apiFlags } = require('../modules/api-claim-preparation/service');

const createdAt = new Date('2026-09-24T03:00:00Z');
const caseRecord = { id: 'case-1', createdAt, currentStatus: 'API_DOCUMENTS_VERIFIED' };
const extractedFields = { claim: { insurer_case_number: 'OCR-READ-NUMBER' } };
const inputWith = (documentCheck) => ({
  'api-claim-intake': { clNo: '2604050015', tpaCaseNumber: 'STEVENEVERHILLC58', crtDate: '2026-09-24T09:00:00' },
  'api-material-download': { documents: [
    { barcodeId: 'LATER', createdAt: '2026-09-24T05:00:00Z', documentIds: ['d2'] },
    { barcodeId: 'FIRST', createdAt: '2026-09-24T04:00:00Z', documentIds: ['d1'] },
  ] },
  'api-claim-recognition': { recognizedType: 'ayas_member_claim', extractedFields },
  'api-member-verification': { iasMemberInfoResponse: { success: true, payload: { member: {} } } },
  'api-document-checking': documentCheck,
});
const passed = { outcome: 'DOCUMENT_CHECKED', checkedAt: '2026-09-24T06:00:00.000Z' };
const failed = { outcome: 'INCOMPLETE', checkedAt: '2026-09-24T06:00:00.000Z' };
const prepared = (isStp) => ({
  payload: { MemberRefNo: 'M1', TpaCaseNumber: 'OCR-READ-NUMBER', barcode: 'FIRST', isValidation: 'N', isCSR: 'N', Items: [{ PresentedAmt: 1000 }] },
  diagnosis: { diagCode: 'J06.9' },
  lines: [{ subtotal: 1000 }],
  isStp,
  claimPrepMeta: { lines: [] },
});

beforeEach(() => jest.clearAllMocks());

it('runs whether the documents passed or not, with every earlier output it needs', () => {
  expect(job).toMatchObject({
    inputStatus: ['API_DOCUMENTS_VERIFIED', 'API_INCOMPLETE'],
    inputs: ['api-claim-intake', 'api-material-download', 'api-claim-recognition', 'api-member-verification', 'api-document-checking'],
  });
});

it("builds the email flow's payload from the earlier outputs, then the revision body", async () => {
  checkCase.mockResolvedValue(prepared(false));

  const result = await job.process({ caseRecord, input: inputWith(passed) });

  expect(checkCase).toHaveBeenCalledWith({
    id: 'case-1',
    extractedFields,
    recognizedType: 'ayas_member_claim',
    iasMemberInfoResponse: { success: true, payload: { member: {} } },
    createdAt,
    consoleBarcode: 'FIRST',
    consoleUploadResult: { completedAt: '2026-09-24T06:00:00.000Z' },
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

it('prepares a suspended revision when documents are missing, without a completion date', async () => {
  checkCase.mockResolvedValue(prepared(true)); // even an STP amount

  const result = await job.process({ caseRecord: { ...caseRecord, currentStatus: 'API_INCOMPLETE' }, input: inputWith(failed) });

  expect(checkCase.mock.calls[0][0].consoleUploadResult).toEqual({ completedAt: null });
  expect(result.output).toMatchObject({ documentsComplete: false, payload: { isValidation: 'Y', isCSR: 'N', isSuspense: 'Y' } });
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
