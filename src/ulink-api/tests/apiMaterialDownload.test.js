const JSZip = require('jszip');

// api-material-download: scan matching, zip batching and entry checks, the grace period (S4),
// partial downloads (S5), and skipping documents that already exist. job.process is called
// directly with the same input the runner gives it; the middleware, storage adapter and
// CaseDocument are in-memory. Zips are real (jszip). The runner itself is covered by
// tests/runApiJob.test.js.

jest.mock('../config', () => ({ apiMaterialDownload: { graceMinutes: 120, batchLimit: 10, middlewareUrl: 'http://middleware.test' } }));
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
const storage = require('../storage');
const models = require('../db/models');
const { job, scanIdFor, belongsToScan, zipBatches, readZip, withinGrace } = require('../modules/api-material-download/service');

async function zipOf(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const material = (id) => ({ material: id, originalname: `${id}.jpg` });
const caseRecord = { id: 'case-1' };
const LONG_AGO = '2026-06-30T14:50:18'; // far past the grace period
const inputFor = (crtDate) => ({ 'api-claim-intake': { clNo: '2604050015', tpaCaseNumber: 'T2', crtDate } });
// A Myanmar-local timestamp (no offset, like IAS crtDate) `minutesAgo` minutes before now.
const myanmarLocal = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000 + 390 * 60000).toISOString().slice(0, 19);

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
  it('waits for 120 minutes after crtDate (Myanmar time)', () => {
    expect(withinGrace(myanmarLocal(30))).toBe(true);
    expect(withinGrace(myanmarLocal(150))).toBe(false);
    expect(withinGrace('not a date')).toBe(false);
  });
});

describe('job.process', () => {
  it('receives api-claim-intake output and runs only on API_RECEIVED', () => {
    expect(job).toMatchObject({ inputStatus: 'API_RECEIVED', inputs: ['api-claim-intake'] });
  });

  it("stores every image of the scan's own submissions as case documents", async () => {
    listMaterials
      .mockResolvedValueOnce({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] }], hasMore: true })
      .mockResolvedValueOnce({
        items: [
          { barcodeId: 'B2', scanId: 'API-T2-02', materials: [material('m2')] },
          { barcodeId: 'ZZ', scanId: 'API-T22-01', materials: [material('m3')] }, // another claim
        ],
        hasMore: false,
      });
    downloadZip.mockResolvedValue(await zipOf({ 'API-T2/B1/m1.jpg': '1', 'API-T2/B2/m2.jpg': '2' }));

    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });

    expect(listMaterials.mock.calls).toEqual([['API-T2', 0], ['API-T2', 1]]);
    expect(downloadZip.mock.calls[0][1].map((i) => i.barcodeId)).toEqual(['B1', 'B2']);
    expect([...storage.files.keys()]).toEqual(['api/API-T2/B1/m1.jpg', 'api/API-T2/B2/m2.jpg']);
    expect(models.docs[0]).toMatchObject({ origin: 'CONSOLE', barcodeId: 'B1', scanId: 'API-T2-01', originalFilename: 'm1.jpg', contentType: 'image/jpeg' });
    expect(result).toEqual({
      nextStatus: 'API_MATERIALS_DOWNLOADED',
      message: expect.any(String),
      output: {
        scanId: 'API-T2',
        fileCount: 2,
        documents: [
          { barcodeId: 'B1', scanId: 'API-T2-01', createdAt: undefined, expected: 1, documentIds: ['doc-1'] },
          { barcodeId: 'B2', scanId: 'API-T2-02', createdAt: undefined, expected: 1, documentIds: ['doc-2'] },
        ],
      },
    });
  });

  it('waits while the console has no images yet, within the grace period', async () => {
    listMaterials.mockResolvedValue({ items: [], hasMore: false });
    const result = await job.process({ caseRecord, input: inputFor(myanmarLocal(30)) });
    expect(result).toMatchObject({ wait: true, output: { scanId: 'API-T2' } });
    expect(downloadZip).not.toHaveBeenCalled();
  });

  it('continues with no documents once the grace period is over', async () => {
    listMaterials.mockResolvedValue({ items: [], hasMore: false });
    const result = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(result).toMatchObject({ nextStatus: 'API_NO_DOCUMENTS', output: { fileCount: 0, documents: [] } });
  });

  it('keeps a partial download and waits; the retry fetches only the incomplete submission', async () => {
    const items = [
      { barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('a'), material('b')] },
      { barcodeId: 'B2', scanId: 'API-T2-02', materials: [material('c')] },
    ];
    listMaterials.mockResolvedValue({ items, hasMore: false });
    downloadZip.mockResolvedValueOnce(await zipOf({ 'API-T2/B1/a.jpg': 'a', 'API-T2/B2/c.jpg': 'c' })); // b failed

    const first = await job.process({ caseRecord, input: inputFor(LONG_AGO) });
    expect(first).toMatchObject({ wait: true, output: { fileCount: 2, reason: expect.stringMatching(/2 of 3/) } });

    downloadZip.mockResolvedValueOnce(await zipOf({ 'API-T2/B1/a.jpg': 'a', 'API-T2/B1/b.jpg': 'b' }));
    const second = await job.process({ caseRecord, input: inputFor(LONG_AGO) });

    expect(downloadZip.mock.calls[1][1].map((i) => i.barcodeId)).toEqual(['B1']); // B2 already complete
    expect(models.docs.map((d) => d.originalFilename)).toEqual(['a.jpg', 'c.jpg', 'b.jpg']); // a.jpg not stored twice
    expect(second).toMatchObject({ nextStatus: 'API_MATERIALS_DOWNLOADED', output: { fileCount: 3 } });
  });

  it('lets a middleware failure throw (the runner records it and retries next run)', async () => {
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] }], hasMore: false });
    downloadZip.mockRejectedValue(new Error('Middleware /api/files/download/zip failed with status 502'));
    await expect(job.process({ caseRecord, input: inputFor(LONG_AGO) })).rejects.toThrow(/502/);
    expect(models.docs).toHaveLength(0);
  });
});
