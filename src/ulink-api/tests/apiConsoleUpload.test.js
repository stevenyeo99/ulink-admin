// api-console-upload + api-console-barcode: a case-page upload is read first, then — after the document check — sent
// to the IAS console, and the IAS revision waits for its barcode. cl-upload, storage and the middleware are replaced.

jest.mock('../db/models', () => ({ CaseDocument: { findAll: jest.fn() } }));
jest.mock('../storage', () => ({ getStorageAdapter: () => ({ get: async (ref) => Buffer.from(`pdf:${ref}`) }) }));
jest.mock('../modules/console-upload/clUploadClient', () => ({
  ...jest.requireActual('../modules/console-upload/clUploadClient'),
  uploadToConsole: jest.fn(),
}));
jest.mock('../modules/api-material-download/service', () => ({
  ...jest.requireActual('../modules/api-material-download/service'),
  listScanItems: jest.fn(),
}));

const config = require('../config');
const { CaseDocument } = require('../db/models');
const { uploadToConsole, UploadRejected } = require('../modules/console-upload/clUploadClient');
const { listScanItems } = require('../modules/api-material-download/service');
const { job: uploadJob } = require('../modules/api-console-upload/service');
const { job: barcodeJob } = require('../modules/api-console-barcode/service');
const { API_STEPS } = require('../modules/pipeline/service');
const { CASE_STATUSES } = require('../modules/case-status/catalog');

const intake = { 'api-claim-intake': { tpaCaseNumber: 'AYA-CL-26100012' } };
const upload = (input) => uploadJob.process({ caseRecord: { id: 'case-1' }, input: { ...intake, ...input } });
const barcode = (status, uploads) => barcodeJob.process({ caseRecord: { id: 'case-1', currentStatus: status }, input: { ...intake, 'api-console-upload': { uploads } } });

// The case's uploads (case documents, origin UPLOAD); scanId set once sent.
let documents;
const doc = (id, scanId = null) => ({ id, scanId, originalFilename: `${id}.pdf`, storageRef: `ref-${id}`, update: jest.fn(async (f) => Object.assign(documents.find((d) => d.id === id), f)) });

beforeEach(() => {
  jest.clearAllMocks();
  documents = [];
  CaseDocument.findAll.mockImplementation(async () => documents);
});

it('runs after the document check and before claim preparation; every status it sets exists', () => {
  const names = API_STEPS.map(([n]) => n);
  expect(names.slice(names.indexOf('api-document-checking'), names.indexOf('api-claim-preparation') + 1))
    .toEqual(['api-document-checking', 'api-console-upload', 'api-console-barcode', 'api-claim-preparation']);
  for (const s of ['API_UPLOAD_RECEIVED', 'API_CONSOLE_BARCODE_PENDING', 'API_CONSOLE_BARCODE_MISSING', 'API_CONSOLE_UPLOAD_FAILED', 'API_READY_FOR_CLAIM_PREPARATION']) {
    expect(CASE_STATUSES[s]).toBeDefined();
  }
});

it('no case-page upload, or all sent already → straight on to claim preparation', async () => {
  expect(await upload({})).toMatchObject({ nextStatus: 'API_READY_FOR_CLAIM_PREPARATION', output: { uploads: [] } });
  documents = [doc('d1', 'API-AYA-CL-26100012-01')];
  const earlier = { uploads: [{ documentId: 'd1', scanId: 'API-AYA-CL-26100012-01', uploadedAt: 't1' }] };
  expect(await upload({ 'api-console-upload': earlier })).toMatchObject({ nextStatus: 'API_READY_FOR_CLAIM_PREPARATION', output: earlier });
  expect(uploadToConsole).not.toHaveBeenCalled();
});

it('sends each new upload as its own PDF, records its scan id on the document, keeps the earlier rounds', async () => {
  documents = [doc('d1', 'API-AYA-CL-26100012-01'), doc('d2')];
  uploadToConsole.mockResolvedValue({ path: '/outbox/API-AYA-CL-26100012-02/d2.pdf' });
  const earlier = { uploads: [{ documentId: 'd1', scanId: 'API-AYA-CL-26100012-01', uploadedAt: 't1' }] };
  const result = await upload({ 'api-console-upload': earlier });
  expect(uploadToConsole).toHaveBeenCalledTimes(1);
  expect(uploadToConsole).toHaveBeenCalledWith({ tpaCaseNumber: 'AYA-CL-26100012', pdf: Buffer.from('pdf:ref-d2'), filename: 'd2.pdf' });
  expect(documents[1].scanId).toBe('API-AYA-CL-26100012-02');
  expect(result).toMatchObject({
    nextStatus: 'API_CONSOLE_BARCODE_PENDING',
    output: { uploads: [{ documentId: 'd1', uploadedAt: 't1' }, { documentId: 'd2', scanId: 'API-AYA-CL-26100012-02' }] },
  });
});

it('a network failure after one upload went through never sends that one again', async () => {
  documents = [doc('d1'), doc('d2')];
  uploadToConsole.mockResolvedValueOnce({ path: '/outbox/API-AYA-CL-26100012-01/d1.pdf' }).mockRejectedValueOnce(new Error('cl-upload timed out'));
  await expect(upload({})).rejects.toThrow('timed out');
  uploadToConsole.mockResolvedValueOnce({ path: '/outbox/API-AYA-CL-26100012-02/d2.pdf' });
  const result = await upload({});
  expect(uploadToConsole.mock.calls.map(([a]) => a.filename)).toEqual(['d1.pdf', 'd2.pdf', 'd2.pdf']);
  expect(result).toMatchObject({ nextStatus: 'API_CONSOLE_BARCODE_PENDING', output: { uploads: [{ scanId: 'API-AYA-CL-26100012-01' }, { scanId: 'API-AYA-CL-26100012-02' }] } });
});

it('the console said no, or gave no scan id → a person looks', async () => {
  documents = [doc('d1')];
  uploadToConsole.mockRejectedValueOnce(new UploadRejected('cl-upload refused the upload (status 400)'));
  expect(await upload({})).toMatchObject({ nextStatus: 'API_CONSOLE_UPLOAD_FAILED', output: { reasonCode: 'CONSOLE_UPLOAD_REFUSED', uploads: [] } });
  uploadToConsole.mockResolvedValueOnce({ path: '/outbox/somewhere/d1.pdf' });
  expect(await upload({})).toMatchObject({ nextStatus: 'API_CONSOLE_UPLOAD_FAILED', output: { reasonCode: 'CONSOLE_SCAN_ID_UNKNOWN' } });
});

it('every upload has its barcode → claim preparation gets all of ours (every round), not the others', async () => {
  const uploads = [{ scanId: 'API-AYA-CL-26100012-01', uploadedAt: new Date().toISOString() }, { scanId: 'API-AYA-CL-26100012-02', uploadedAt: new Date().toISOString() }];
  listScanItems.mockResolvedValue([
    { barcodeId: 'B0', scanId: 'API-AYA-CL-26100012', createdAt: '1' },
    { barcodeId: 'B1', scanId: 'API-AYA-CL-26100012-01', createdAt: '2' },
    { barcodeId: 'B2', scanId: 'API-AYA-CL-26100012-02', createdAt: '3' },
  ]);
  expect(await barcode('API_CONSOLE_BARCODE_PENDING', uploads)).toMatchObject({
    nextStatus: 'API_READY_FOR_CLAIM_PREPARATION',
    output: { barcodes: [{ barcodeId: 'B1' }, { barcodeId: 'B2' }] },
  });
});

it('no barcode yet → waits; overdue → missing once, then keeps checking', async () => {
  listScanItems.mockResolvedValue([{ barcodeId: null, scanId: 'API-AYA-CL-26100012-01' }]); // listed, barcode not made yet
  const now = [{ scanId: 'API-AYA-CL-26100012-01', uploadedAt: new Date().toISOString() }];
  const longAgo = [{ scanId: 'API-AYA-CL-26100012-01', uploadedAt: new Date(Date.now() - (config.clUpload.barcodeWaitMinutes + 1) * 60000).toISOString() }];
  expect(await barcode('API_CONSOLE_BARCODE_PENDING', now)).toMatchObject({ wait: true });
  expect(await barcode('API_CONSOLE_BARCODE_PENDING', longAgo)).toMatchObject({ nextStatus: 'API_CONSOLE_BARCODE_MISSING' });
  expect(await barcode('API_CONSOLE_BARCODE_MISSING', longAgo)).toMatchObject({ wait: true });
});
