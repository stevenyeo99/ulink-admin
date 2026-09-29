// Console upload by API (cl-upload) — the upload side: one merged PDF, case number check, and what each
// answer from the API does to the case (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md).

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { update: jest.fn(), findAll: jest.fn() },
  CaseEvent: { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../modules/shared/gatherAttachments', () => ({ gatherAttachments: jest.fn() }));
jest.mock('../storage', () => ({ getStorageAdapter: () => ({ get: jest.fn(async (ref) => global.testFiles[ref]) }) }));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));

const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const config = require('../config');
const { Case } = require('../db/models');
const { gatherAttachments } = require('../modules/shared/gatherAttachments');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const { mergeToPdf } = require('../modules/console-upload/mergePdf');
const { uploadToConsole, UploadRejected } = require('../modules/console-upload/clUploadClient');
const consoleUpload = require('../modules/console-upload/service');

const onePagePdf = async () => { const doc = await PDFDocument.create(); doc.addPage(); return Buffer.from(await doc.save()); };
const png = () => sharp({ create: { width: 20, height: 30, channels: 3, background: '#fff' } }).png().toBuffer();
const webp = () => sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).webp().toBuffer();

const answer = (status, body) => jest.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body });

beforeAll(async () => {
  global.testFiles = { a: await onePagePdf(), b: await png() };
  Object.assign(config.clUpload, { url: 'https://cl-upload.test', apiKey: 'test-key' });
});
beforeEach(() => jest.clearAllMocks());
afterEach(() => { config.consoleUpload.method = 'folder'; });

it('merges PDFs and images into one PDF, and reports what it had to leave out', async () => {
  const { pdf, pageCount, skipped } = await mergeToPdf([
    { bytes: global.testFiles.a, contentType: 'application/pdf', filename: 'form.pdf' },
    { bytes: global.testFiles.b, contentType: 'image/png', filename: 'bill.png' },
    { bytes: await webp(), contentType: 'image/webp', filename: 'bill2.webp' },
    { bytes: Buffer.from('x'), contentType: 'text/plain', filename: 'note.txt' },
  ]);
  expect(pageCount).toBe(3);
  expect(skipped).toEqual(['note.txt']);
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);
});

describe('uploadToConsole', () => {
  const upload = () => uploadToConsole({ tpaCaseNumber: 'AYA-CL-26031486', pdf: Buffer.from('%PDF'), filename: 'AYA-CL-26031486.pdf' });

  it('sends TpaCaseNumber + file with the API key and returns the console path', async () => {
    global.fetch = answer(200, { status: 'success', path: '/outbox/API-AYA-CL-26031486-01/x.pdf' });
    expect(await upload()).toEqual({ path: '/outbox/API-AYA-CL-26031486-01/x.pdf' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://cl-upload.test');
    expect(init.headers).toEqual({ 'x-api-key': 'test-key' });
    expect(init.body.get('TpaCaseNumber')).toBe('AYA-CL-26031486');
    expect(init.body.get('file').name).toBe('AYA-CL-26031486.pdf');
  });

  it('a refusal is UploadRejected (a person looks); a server error is a plain error (retried)', async () => {
    global.fetch = answer(400, { status: 'error', message: 'bad case' });
    await expect(upload()).rejects.toBeInstanceOf(UploadRejected);
    global.fetch = answer(200, { status: 'failed' });
    await expect(upload()).rejects.toBeInstanceOf(UploadRejected);
    global.fetch = answer(503, null);
    const error = await upload().catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UploadRejected);
  });
});

describe('console-upload job with CONSOLE_UPLOAD_METHOD=cl-upload', () => {
  const caseWith = (caseNumber) => ({
    id: 'case-1',
    currentStatus: 'MEMBER_VERIFIED',
    createdAt: '2026-09-29T08:00:00Z',
    extractedFields: { claim: { insurer_case_number: caseNumber } },
  });
  const runWith = async (caseRecord) => {
    config.consoleUpload.method = 'cl-upload';
    Case.findAll.mockResolvedValue([caseRecord]);
    gatherAttachments.mockResolvedValue([
      { storageRef: 'a', contentType: 'application/pdf', originalFilename: 'form.pdf' },
      { storageRef: 'b', contentType: 'image/png', originalFilename: 'bill.png' },
    ]);
    return consoleUpload.run();
  };
  const statusSet = () => Case.update.mock.calls[0][0];

  it('uploads and waits for the barcode', async () => {
    global.fetch = answer(200, { status: 'success', path: '/outbox/API-AYA-CL-26031486-01/AYA-CL-26031486.pdf' });
    expect(await runWith(caseWith('AYA-CL-26031486'))).toEqual({ processed: 1, errors: [] });
    expect(statusSet()).toMatchObject({
      currentStatus: 'CONSOLE_BARCODE_PENDING',
      consoleUploadResult: { method: 'cl-upload', tpaCaseNumber: 'AYA-CL-26031486', file: 'AYA-CL-26031486.pdf', pageCount: 2, files: ['form.pdf', 'bill.png'] },
    });
    expect(queueDedupedTask).not.toHaveBeenCalled();
  });

  it('does not upload when the case number read from the form looks wrong', async () => {
    global.fetch = jest.fn();
    await runWith(caseWith('AYA-CL-2603I486'));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(statusSet()).toEqual({ currentStatus: 'CASE_NUMBER_UNCLEAR' });
    expect(queueDedupedTask).toHaveBeenCalledWith('tx', expect.objectContaining({ taskType: 'CONSOLE_UPLOAD_ISSUE', payload: expect.objectContaining({ problem: 'Case number unclear' }) }));
  });

  it('a refused upload goes to review; a server error leaves the case to be retried', async () => {
    global.fetch = answer(400, { status: 'error' });
    await runWith(caseWith('AYA-CL-26031486'));
    expect(statusSet()).toEqual({ currentStatus: 'CONSOLE_UPLOAD_FAILED' });

    jest.clearAllMocks();
    global.fetch = answer(502, null);
    const result = await runWith(caseWith('AYA-CL-26031486'));
    expect(result.errors).toHaveLength(1);
    expect(Case.update).not.toHaveBeenCalled();
  });
});
