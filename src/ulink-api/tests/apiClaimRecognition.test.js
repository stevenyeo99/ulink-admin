// api-claim-recognition: reads the case documents named by api-material-download's output with
// the email flow's own transcribePages + extractFields (same prompts, same post-processing), under
// the ayas_member_claim route, without a route decision. The OCR/LLM functions are mocked here —
// what matters is that the API job hands them the same kind of input the email job does.

jest.mock('../modules/claim-recognition/service', () => ({ transcribePages: jest.fn(), extractFields: jest.fn() }));
jest.mock('../storage', () => ({ getStorageAdapter: () => ({ get: jest.fn(async (ref) => Buffer.from(`bytes of ${ref}`)) }) }));
jest.mock('../db/models', () => ({
  ClaimRoute: { findOne: jest.fn() },
  CaseDocument: { findAll: jest.fn() },
}));

const { transcribePages, extractFields } = require('../modules/claim-recognition/service');
const { ClaimRoute, CaseDocument } = require('../db/models');
const { job } = require('../modules/api-claim-recognition/service');

const route = { routeKey: 'ayas_member_claim', extractionSchema: { type: 'object' } };
const caseRecord = { id: 'case-1' };
const input = { 'api-material-download': { scanId: 'API-T2', fileCount: 2, documents: [{ barcodeId: 'B1', documentIds: ['d1', 'd2'] }] } };
const docs = [
  { id: 'd1', barcodeId: 'B1', originalFilename: 'page-000.jpg', storageRef: 'api/API-T2/B1/page-000.jpg' },
  { id: 'd2', barcodeId: 'B1', originalFilename: 'page-001.jpg', storageRef: 'api/API-T2/B1/page-001.jpg' },
];

beforeEach(() => {
  jest.clearAllMocks();
  ClaimRoute.findOne.mockResolvedValue(route);
  CaseDocument.findAll.mockResolvedValue(docs);
  transcribePages.mockImplementation(async (_buffer, filename) => [{ pageNumber: 1, text: `text of ${filename}` }]);
});

it('receives api-material-download output and runs on API_MATERIALS_DOWNLOADED', () => {
  expect(job).toMatchObject({ inputStatus: 'API_MATERIALS_DOWNLOADED', inputs: ['api-material-download'] });
});

it("reads every document with the email flow's OCR and extracts with the ayas_member_claim route", async () => {
  extractFields.mockResolvedValue({ extractedFields: { claimant_name: 'X' }, schemaValidationError: null });

  const result = await job.process({ caseRecord, input });

  expect(CaseDocument.findAll.mock.calls[0][0].where).toEqual({ caseId: 'case-1', id: ['d1', 'd2'] });
  expect(transcribePages.mock.calls.map(([buf, name, label]) => [buf.toString(), name, label])).toEqual([
    ['bytes of api/API-T2/B1/page-000.jpg', 'page-000.jpg', 'd1'],
    ['bytes of api/API-T2/B1/page-001.jpg', 'page-001.jpg', 'd2'],
  ]);
  const transcripts = ['[B1/page-000.jpg - page 1]\ntext of page-000.jpg', '[B1/page-001.jpg - page 1]\ntext of page-001.jpg'];
  expect(extractFields).toHaveBeenCalledWith(transcripts, route);
  expect(result).toEqual({
    nextStatus: 'API_RECOGNIZED',
    message: expect.any(String),
    output: { recognizedType: 'ayas_member_claim', extractedFields: { claimant_name: 'X' }, pageCount: 2, transcripts },
  });
});

it('sends the case to manual review when the extraction does not fit the schema', async () => {
  extractFields.mockResolvedValue({ extractedFields: null, schemaValidationError: 'data must have required property claimant_name' });
  const result = await job.process({ caseRecord, input });
  expect(result).toMatchObject({ nextStatus: 'API_MANUAL_REVIEW', output: { reasonCode: 'SCHEMA_VALIDATION_FAILED' } });
});

it('fails (retried next run) when the route is missing or a document is gone', async () => {
  ClaimRoute.findOne.mockResolvedValueOnce(null);
  await expect(job.process({ caseRecord, input })).rejects.toThrow(/ayas_member_claim is missing/);

  CaseDocument.findAll.mockResolvedValueOnce([docs[0]]);
  await expect(job.process({ caseRecord, input })).rejects.toThrow(/Expected 2 case documents, found 1/);
  expect(extractFields).not.toHaveBeenCalled();
});
