const JSZip = require('jszip');

// api-material-download: scan matching, zip batching and entry checks, the grace period (S4),
// partial downloads (S5), and skipping documents that already exist. job.process is called
// directly with the same input the runner gives it; the middleware, storage adapter and
// CaseDocument are in-memory. Zips are real (jszip). The runner itself is covered by
// tests/runApiJob.test.js.

jest.mock('../config', () => ({ apiMaterialDownload: { graceMinutes: 120, batchLimit: 10, middlewareUrl: 'http://middleware.test' }, claimRecognition: { rasterDpi: 100 } }));
// The PDF merge is replaced: its "PDF" names the images in the order they were given (real merge: mergePdf tests).
jest.mock('../modules/console-upload/mergePdf', () => ({
  mergeToPdf: jest.fn(async (files) => ({ pdf: Buffer.from(`PDF:${files.map((f) => f.filename).join(',')}`), pageCount: files.length, skipped: [] })),
}));
jest.mock('../modules/api-material-download/middlewareClient', () => ({ listMaterials: jest.fn(), downloadZip: jest.fn() }));
jest.mock('../storage', () => {
  const files = new Map();
  return { files, getStorageAdapter: () => ({ put: jest.fn(async (key, bytes) => { files.set(key, bytes); return { storageRef: key }; }) }) };
});
jest.mock('../db/models', () => {
  const docs = [];
  return {
    docs,
    CaseDocument: {
      findAll: jest.fn(async ({ where }) => docs.filter((d) => d.caseId === where.caseId)),
      create: jest.fn(async (row) => { const doc = { id: `doc-${docs.length + 1}`, ...row }; docs.push(doc); return doc; }),
    },
  };
});

const { listMaterials, downloadZip } = require('../modules/api-material-download/middlewareClient');
const { mergeToPdf } = require('../modules/console-upload/mergePdf');
const storage = require('../storage');
const models = require('../db/models');
const { job, scanIdFor, belongsToScan, zipBatches, readZip, withinGrace } = require('../modules/api-material-download/service');

async function zipOf(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const material = (id) => ({ material: id, originalname: `${id}.jpg` });
const caseRecord = { id: 'case-1', createdAt: new Date('2026-06-30T08:00:00Z') }; // received long ago: past the grace period
const LONG_AGO = '2026-06-30T14:50:18'; // far past the grace period
const inputFor = (crtDate) => ({ 'api-claim-intake': { clNo: '2604050015', tpaCaseNumber: 'T2', crtDate } });
const minutesAgo = (n) => new Date(Date.now() - n * 60000);

beforeEach(() => {
  jest.clearAllMocks();
  models.docs.length = 0;
  storage.files.clear();
});

describe('belongsToScan', () => {
  it('keeps the exact scanId and its numbered submissions', () => {
    expect(belongsToScan('API-X68', 'API-X68')).toBe(true);
    expect(belongsToScan('API-X68-01', 'API-X68')).toBe(true);
  });

  it("drops another claim's scan that merely contains this one", () => {
    expect(belongsToScan('API-X688-01', 'API-X68')).toBe(false);
    expect(belongsToScan('API-X68-A', 'API-X68')).toBe(false);
    expect(belongsToScan('OLD-API-X68-01', 'API-X68')).toBe(false);
  });

  it('builds the scanId from the tpaCaseNumber', () => {
    expect(scanIdFor('STEVENEVERHILLC58')).toBe('API-STEVENEVERHILLC58');
  });
});

describe('zipBatches', () => {
  const item = (barcodeId, n) => ({ barcodeId, materials: Array.from({ length: n }, (_, i) => material(`${barcodeId}${i}`)) });

  it('packs items into requests of at most 100 images and skips items without images', () => {
    const batches = zipBatches([item('A', 60), item('B', 0), item('C', 30), item('D', 20)]);
    expect(batches.map((b) => b.map((i) => i.barcodeId))).toEqual([['A', 'C'], ['D']]);
  });
});

describe('readZip', () => {
  const barcodes = new Set(['B1']);

  it('returns each file with its barcode', async () => {
    const files = await readZip(await zipOf({ 'API-T2/B1/page-000.jpg': 'img' }), 'API-T2', barcodes);
    expect(files.map((f) => [f.barcodeId, f.filename, f.bytes.toString()])).toEqual([['B1', 'page-000.jpg', 'img']]);
  });

  it.each([
    ['an absolute path (jszip keeps it as-is)', '/tmp/evil.jpg'],
    ['another scan', 'API-OTHER/B1/page-000.jpg'],
    ['an unknown barcode', 'API-T2/ZZ/page-000.jpg'],
    ['an unsafe file name', 'API-T2/B1/pa ge.jpg'],
    ['an extra folder level', 'API-T2/B1/x/page.jpg'],
  ])('rejects %s', async (_label, name) => {
    await expect(readZip(await zipOf({ [name]: 'x' }), 'API-T2', barcodes)).rejects.toThrow(/Unexpected entry/);
  });
});

describe('withinGrace', () => {
  it('waits for 120 minutes after ULINK received the claim (the case createdAt — no time zone guessed)', () => {
    expect(withinGrace(minutesAgo(30))).toBe(true);
    expect(withinGrace(minutesAgo(150))).toBe(false);
    expect(withinGrace('not a date')).toBe(false);
  });
});

describe('job.process', () => {
  // + API_NEW_DOCUMENTS: new console documents for a case waiting on them (api-console-watch, SYSTEM_4 E4-04).
  it('receives api-claim-intake output and runs on API_RECEIVED and on new console documents', () => {
    expect(job).toMatchObject({ inputStatus: ['API_RECEIVED', 'API_NEW_DOCUMENTS'], inputs: ['api-claim-intake'], optionalInputs: ['api-console-upload'] });
  });

  it("stores each of the scan's own submissions as one PDF, its images as pages in file order", async () => {
    listMaterials
      .mockResolvedValueOnce({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1'), material('m10'), material('m2')] }], hasMore: true })
      .mockResolvedValueOnce({
        items: [
          { barcodeId: 'B2', scanId: 'API-T2-02', materials: [material('m3')] },
          { barcodeId: 'ZZ', scanId: 'API-T22-01', materials: [material('m4')] }, // another claim
        ],
        hasMore: false,
      });
    downloadZip.mockResolvedValue(await zipOf({ 'API-T2/B1/page-10.jpg': '10', 'API-T2/B1/page-2.jpg': '2', 'API-T2/B1/page-1.jpg': '1', 'API-T2/B2/m3.jpg': '3' }));

    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });

    expect(listMaterials.mock.calls).toEqual([['API-T2', 0], ['API-T2', 1]]);
    expect(downloadZip.mock.calls[0][1].map((i) => i.barcodeId)).toEqual(['B1', 'B2']);
    // Pages in file order (page-1, page-2, page-10), sized for the AI's rendering resolution.
    expect(mergeToPdf.mock.calls[0][0].map((f) => f.filename)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-10.jpg']);
    expect(mergeToPdf.mock.calls[0][1]).toEqual({ imageDpi: 100 });
    // Under the day stored (UTC), like every stored file.
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    expect([...storage.files.keys()]).toEqual([`${day}/api/API-T2/B1/B1.pdf`, `${day}/api/API-T2/B2/B2.pdf`]);
    expect(models.docs[0]).toMatchObject({ origin: 'CONSOLE', barcodeId: 'B1', scanId: 'API-T2-01', originalFilename: 'B1.pdf', contentType: 'application/pdf' });
    expect(result).toEqual({
      nextStatus: 'API_MATERIALS_DOWNLOADED',
      message: '4 image(s) from 2 console submission(s) stored as 2 PDF document(s)',
      output: {
        scanId: 'API-T2',
        fileCount: 2,
        documents: [
          { barcodeId: 'B1', scanId: 'API-T2-01', createdAt: undefined, expected: 3, documentIds: ['doc-1'] },
          { barcodeId: 'B2', scanId: 'API-T2-02', createdAt: undefined, expected: 1, documentIds: ['doc-2'] },
        ],
      },
    });
  });

  it("an image that can't go into a PDF stores that submission image by image — the case is never stuck", async () => {
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('a'), material('b')] }], hasMore: false });
    downloadZip.mockResolvedValue(await zipOf({ 'API-T2/B1/a.jpg': 'a', 'API-T2/B1/b.jpg': 'b' }));
    mergeToPdf.mockRejectedValueOnce(new Error('SOI not found in JPEG'));
    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(models.docs.map((d) => d.originalFilename)).toEqual(['a.jpg', 'b.jpg']);
    expect(result).toMatchObject({ nextStatus: 'API_MATERIALS_DOWNLOADED', output: { documents: [{ documentIds: ['doc-1', 'doc-2'] }] } });
  });

  it("pages follow the console's own order when the file names match it", async () => {
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('zz'), material('aa')] }], hasMore: false });
    downloadZip.mockResolvedValue(await zipOf({ 'API-T2/B1/aa.jpg': 'a', 'API-T2/B1/zz.jpg': 'z' }));
    await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(mergeToPdf.mock.calls[0][0].map((f) => f.filename)).toEqual(['zz.jpg', 'aa.jpg']);
  });

  it('a submission downloaded before as images is not downloaded again, and keeps its images', async () => {
    models.docs.push({ id: 'old-1', caseId: 'case-1', barcodeId: 'B1', originalFilename: 'm1.jpg' });
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] }], hasMore: false });
    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(downloadZip).not.toHaveBeenCalled();
    expect(result.output.documents[0].documentIds).toEqual(['old-1']);
  });

  it('never downloads our own case-page uploads (api-console-upload) — the case read them already', async () => {
    listMaterials.mockResolvedValue({ items: [
      { barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] },
      { barcodeId: 'B2', scanId: 'API-T2-02', materials: [material('m2')] }, // ours
    ], hasMore: false });
    downloadZip.mockResolvedValue(await zipOf({ 'API-T2/B1/m1.jpg': '1' }));
    const input = { ...inputFor(LONG_AGO), 'api-console-upload': { uploads: [{ scanId: 'API-T2-02' }] } };
    const result = await job.process({ caseRecord, input });
    expect(downloadZip.mock.calls[0][1].map((i) => i.barcodeId)).toEqual(['B1']);
    expect(result.output.documents.map((d) => d.barcodeId)).toEqual(['B1']);
  });

  it('waits while the console has no images yet, within the grace period', async () => {
    listMaterials.mockResolvedValue({ items: [], hasMore: false });
    // IAS's crtDate is ignored (the UAT IAS writes it in UTC+7): only when ULINK received the claim counts.
    const result = await job.process({ caseRecord: { ...caseRecord, createdAt: minutesAgo(30) }, input: inputFor(LONG_AGO) });
    expect(result).toMatchObject({ wait: true, output: { scanId: 'API-T2' } });
    expect(downloadZip).not.toHaveBeenCalled();
  });

  it('continues with no documents once the grace period is over', async () => {
    listMaterials.mockResolvedValue({ items: [], hasMore: false });
    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(result).toMatchObject({ nextStatus: 'API_NO_DOCUMENTS', output: { fileCount: 0, documents: [] } });
  });

  it('stores a complete submission; one with an image missing waits whole for the next run (never a PDF missing pages)', async () => {
    const items = [
      { barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('a'), material('b')] },
      { barcodeId: 'B2', scanId: 'API-T2-02', materials: [material('c')] },
    ];
    listMaterials.mockResolvedValue({ items, hasMore: false });
    downloadZip.mockResolvedValueOnce(await zipOf({ 'API-T2/B1/a.jpg': 'a', 'API-T2/B2/c.jpg': 'c' })); // b failed

    const first = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(first).toMatchObject({ wait: true, output: { reason: expect.stringMatching(/B1 \(1 of 2 images\)/) } });
    expect(models.docs.map((d) => d.originalFilename)).toEqual(['B2.pdf']);

    downloadZip.mockResolvedValueOnce(await zipOf({ 'API-T2/B1/a.jpg': 'a', 'API-T2/B1/b.jpg': 'b' }));
    const second = await job.process({ caseRecord, input: inputFor(LONG_AGO) });

    expect(downloadZip.mock.calls[1][1].map((i) => i.barcodeId)).toEqual(['B1']); // B2 already stored
    expect(models.docs.map((d) => d.originalFilename)).toEqual(['B2.pdf', 'B1.pdf']);
    expect(second).toMatchObject({ nextStatus: 'API_MATERIALS_DOWNLOADED', output: { fileCount: 2 } });
  });

  it('lets a middleware failure throw (the runner records it and retries next run)', async () => {
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] }], hasMore: false });
    downloadZip.mockRejectedValue(new Error('Middleware /api/files/download/zip failed with status 502'));
    await expect(job.process({ caseRecord, input: inputFor(LONG_AGO) })).rejects.toThrow(/502/);
    expect(models.docs).toHaveLength(0);
  });
});
