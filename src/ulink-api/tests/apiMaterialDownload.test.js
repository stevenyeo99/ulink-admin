const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// api-material-download: scan matching, zip batching, safe unpacking, and run()'s status
// handling. The middleware and DB are mocked; zips are real (jszip) and unpacked into a temp
// folder. The real middleware call is exercised by running the job against a local middleware.

jest.mock('../config', () => {
  const os = jest.requireActual('os');
  const nodePath = jest.requireActual('path');
  const nodeFs = jest.requireActual('fs');
  return {
    apiMaterialDownload: {
      root: nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'api-materials-test-')),
      batchLimit: 10,
      middlewareUrl: 'http://middleware.test',
    },
  };
});
jest.mock('../modules/api-material-download/middlewareClient', () => ({ listMaterials: jest.fn(), downloadZip: jest.fn() }));
jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn({}) },
  Case: { findAll: jest.fn(), update: jest.fn().mockResolvedValue([1]) },
  CaseEvent: { create: jest.fn().mockResolvedValue({}) },
}));

const config = require('../config');
const { Case, CaseEvent } = require('../db/models');
const { listMaterials, downloadZip } = require('../modules/api-material-download/middlewareClient');
const { run, scanIdFor, belongsToScan, zipBatches, extractZip } = require('../modules/api-material-download/service');

const root = config.apiMaterialDownload.root;
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function zipOf(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const material = (id) => ({ material: id, originalname: `${id}.jpg` });

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

describe('extractZip', () => {
  it('writes entries under root and returns their relative paths', async () => {
    const written = await extractZip(await zipOf({ 'API-T1/B1/page-000.jpg': 'img' }), root);
    expect(written).toEqual(['API-T1/B1/page-000.jpg']);
    expect(fs.readFileSync(path.join(root, 'API-T1/B1/page-000.jpg'), 'utf8')).toBe('img');
  });

  it('refuses an absolute entry path (jszip keeps it as-is)', async () => {
    const buffer = await zipOf({ '/tmp/api-materials-evil.txt': 'x' });
    await expect(extractZip(buffer, root)).rejects.toThrow(/escapes the download folder/);
    expect(fs.existsSync('/tmp/api-materials-evil.txt')).toBe(false);
  });

  it('keeps a "../" entry inside root (jszip strips the traversal on load)', async () => {
    const written = await extractZip(await zipOf({ '../escape.txt': 'x' }), root);
    expect(written).toEqual(['escape.txt']);
    expect(fs.existsSync(path.join(root, '..', 'escape.txt'))).toBe(false);
  });
});

describe('run', () => {
  const apiCase = { id: 'case-1', tpaCaseNumber: 'T2' };

  beforeEach(() => {
    jest.clearAllMocks();
    Case.findAll.mockResolvedValue([apiCase]);
  });

  it('selects only API_RECEIVED API cases', async () => {
    Case.findAll.mockResolvedValue([]);
    await run();
    expect(Case.findAll.mock.calls[0][0].where).toEqual({ source: 'API', currentStatus: 'API_RECEIVED' });
  });

  it("downloads the scan's own submissions across pages and records every barcode", async () => {
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

    expect(await run()).toEqual({ processed: 1, errors: [] });

    expect(listMaterials.mock.calls).toEqual([['API-T2', 0], ['API-T2', 1]]);
    expect(downloadZip.mock.calls[0][1].map((i) => i.barcodeId)).toEqual(['B1', 'B2']);
    const [update] = Case.update.mock.calls[0];
    expect(update.currentStatus).toBe('API_MATERIALS_DOWNLOADED');
    expect(update.apiMaterialsResult).toMatchObject({
      scanId: 'API-T2',
      fileCount: 2,
      barcodes: [
        { barcodeId: 'B1', scanId: 'API-T2-01', expected: 1, files: ['API-T2/B1/m1.jpg'] },
        { barcodeId: 'B2', scanId: 'API-T2-02', expected: 1, files: ['API-T2/B2/m2.jpg'] },
      ],
    });
    expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'API_MATERIALS_DOWNLOADED' }), expect.anything());
  });

  it('continues with no files when the console has no images yet', async () => {
    listMaterials.mockResolvedValue({ items: [], hasMore: false });

    expect(await run()).toEqual({ processed: 1, errors: [] });

    expect(downloadZip).not.toHaveBeenCalled();
    expect(Case.update.mock.calls[0][0]).toMatchObject({ currentStatus: 'API_MATERIALS_DOWNLOADED', apiMaterialsResult: { fileCount: 0, barcodes: [] } });
  });

  it('leaves the case at API_RECEIVED when the middleware fails', async () => {
    listMaterials.mockResolvedValue({ items: [{ barcodeId: 'B1', scanId: 'API-T2-01', materials: [material('m1')] }], hasMore: false });
    downloadZip.mockRejectedValue(new Error('Middleware /api/files/download/zip failed with status 502: No materials could be downloaded'));

    const summary = await run();

    expect(summary.processed).toBe(0);
    expect(summary.errors[0].error).toMatch(/502/);
    expect(Case.update).not.toHaveBeenCalled();
  });
});
