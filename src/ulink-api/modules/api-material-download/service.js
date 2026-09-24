const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { listMaterials, downloadZip } = require('./middlewareClient');

// api-material-download: API case workflow step 2 (docs/imp/day1/api-case-workflow.md section
// 6.3). Downloads an API_RECEIVED case's console images through ulink-console-middleware's zip
// endpoint, unpacks them under API_MATERIAL_DOWNLOAD_ROOT, and hands the case to OCR.

const BLOCK_NAME = 'api-material-download';
const MAX_MATERIALS_PER_ZIP = 100; // the middleware's own per-request limit

function scanIdFor(tpaCaseNumber) {
  return `API-${tpaCaseNumber}`;
}

// The middleware's scanId search is a contains match, so API-X68 also returns API-X688-01.
// A case owns only its exact scanId and its numbered submissions (API-X68-01, API-X68-02).
function belongsToScan(itemScanId, scanId) {
  if (typeof itemScanId !== 'string' || !itemScanId.startsWith(scanId)) return false;
  const rest = itemScanId.slice(scanId.length);
  return rest === '' || /^-\d+$/.test(rest);
}

async function listScanItems(scanId) {
  const items = [];
  for (let skip = 0; ; ) {
    const page = await listMaterials(scanId, skip);
    const pageItems = Array.isArray(page.items) ? page.items : [];
    items.push(...pageItems.filter((item) => belongsToScan(item.scanId, scanId)));
    if (!page.hasMore || pageItems.length === 0) return items;
    skip += pageItems.length;
  }
}

// Groups items into zip requests of at most MAX_MATERIALS_PER_ZIP images. Only items with
// images are sent (the middleware rejects an item with none).
function zipBatches(items) {
  const batches = [];
  let current = [];
  let count = 0;
  for (const item of items.filter((i) => Array.isArray(i.materials) && i.materials.length > 0)) {
    if (current.length > 0 && count + item.materials.length > MAX_MATERIALS_PER_ZIP) {
      batches.push(current);
      current = [];
      count = 0;
    }
    current.push(item);
    count += item.materials.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Unpacks a zip under root and returns the written paths relative to root. Entry names come
// from another service, so each one must resolve inside root (no "../" escapes).
async function extractZip(buffer, root) {
  const zip = await JSZip.loadAsync(buffer);
  const written = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const dest = path.resolve(root, entry.name);
    if (!dest.startsWith(root + path.sep)) {
      throw new Error(`Zip entry escapes the download folder: ${entry.name}`);
    }
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, await entry.async('nodebuffer'));
    written.push(path.relative(root, dest).split(path.sep).join('/'));
  }
  return written;
}

/**
 * Downloads one case's images and returns what becomes Case.apiMaterialsResult. The scan's
 * folder is emptied first, so a retry after a half-finished run can't leave stale files. No
 * images in the console is not an error: the case continues with none, and document checking
 * will ask the customer for the missing documents.
 */
async function downloadCase(caseRecord) {
  const root = path.resolve(config.apiMaterialDownload.root);
  const scanId = scanIdFor(caseRecord.tpaCaseNumber);
  const folder = path.join(root, scanId);

  const items = await listScanItems(scanId);
  await fs.promises.rm(folder, { recursive: true, force: true });

  const files = [];
  for (const batch of zipBatches(items)) {
    files.push(...(await extractZip(await downloadZip(scanId, batch), root)));
  }

  return {
    scanId,
    folder,
    fileCount: files.length,
    barcodes: items.map((item) => ({
      barcodeId: item.barcodeId,
      scanId: item.scanId,
      createdAt: item.createdAt,
      expected: Array.isArray(item.materials) ? item.materials.length : 0,
      files: files.filter((f) => f.startsWith(`${scanId}/${item.barcodeId}/`)),
    })),
    downloadedAt: new Date().toISOString(),
  };
}

async function persistOutcome(caseRecord, result) {
  const message = result.fileCount > 0
    ? `${result.fileCount} image(s) from ${result.barcodes.length} console submission(s) downloaded to ${result.folder}`
    : `No images in the console for ${result.scanId}; continuing, document checking will ask for them`;

  await sequelize.transaction(async (transaction) => {
    await Case.update(
      { currentStatus: 'API_MATERIALS_DOWNLOADED', apiMaterialsResult: result },
      { where: { id: caseRecord.id }, transaction }
    );
    await CaseEvent.create({
      caseId: caseRecord.id,
      blockName: BLOCK_NAME,
      prevStatus: 'API_RECEIVED',
      newStatus: 'API_MATERIALS_DOWNLOADED',
      message,
    }, { transaction });
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { source: 'API', currentStatus: 'API_RECEIVED' },
    limit: config.apiMaterialDownload.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const result = await downloadCase(caseRecord);
      await persistOutcome(caseRecord, result);
      results.push({ caseId: caseRecord.id, ok: true, fileCount: result.fileCount });
    } catch (error) {
      // Technical failure (middleware down, timeout, every image failing, disk error): the case
      // stays at API_RECEIVED and is retried next run, same as every other job.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  return {
    processed: results.filter((r) => r.ok).length,
    errors: results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error })),
  };
}

module.exports = { run, downloadCase, scanIdFor, belongsToScan, zipBatches, extractZip };
