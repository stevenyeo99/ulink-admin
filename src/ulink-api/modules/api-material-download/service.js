const path = require('path');
const JSZip = require('jszip');
const { CaseDocument } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { listMaterials, downloadZip } = require('./middlewareClient');

// api-material-download: API case workflow job 2 (docs/imp/day1/api-case-workflow.md section 6.3).
//
//   input:  { 'api-claim-intake': { clNo, tpaCaseNumber, crtDate } }
//   output: { scanId, fileCount, documents: [{ barcodeId, scanId, createdAt, expected, documentIds }] }
//
// Downloads the case's console images through ulink-console-middleware's zip endpoint and stores
// each one as a case document (ulink_case_documents, same storage adapter as email attachments).

const JOB = 'api-material-download';
const MAX_MATERIALS_PER_ZIP = 100; // the middleware's own per-request limit
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/; // the middleware's own file-name rule
const CONTENT_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

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

const materialCount = (item) => (Array.isArray(item.materials) ? item.materials.length : 0);

// Groups items into zip requests of at most MAX_MATERIALS_PER_ZIP images. Only items with
// images are sent (the middleware rejects an item with none).
function zipBatches(items) {
  const batches = [];
  let current = [];
  let count = 0;
  for (const item of items.filter((i) => materialCount(i) > 0)) {
    if (current.length > 0 && count + materialCount(item) > MAX_MATERIALS_PER_ZIP) {
      batches.push(current);
      current = [];
      count = 0;
    }
    current.push(item);
    count += materialCount(item);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * The zip's files as { barcodeId, filename, bytes }. Entry names come from another service, so
 * each must be exactly <scanId>/<one of this scan's barcodes>/<safe file name>; anything else
 * fails the case rather than being stored under a name we didn't expect.
 */
async function readZip(buffer, scanId, barcodeIds) {
  const zip = await JSZip.loadAsync(buffer);
  const files = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const parts = entry.name.split('/');
    const [top, barcodeId, filename] = parts;
    if (parts.length !== 3 || top !== scanId || !barcodeIds.has(barcodeId) || !SAFE_FILENAME.test(filename) || /^\.+$/.test(filename)) {
      throw new Error(`Unexpected entry in the middleware zip: ${entry.name}`);
    }
    files.push({ barcodeId, filename, bytes: await entry.async('nodebuffer') });
  }
  return files;
}

// Still inside the grace period after the IAS claim was created? crtDate has no offset; it is
// IAS's own time, Myanmar (UTC+6:30). An unreadable date means no grace.
function withinGrace(crtDate, now = new Date()) {
  const created = Date.parse(`${crtDate}+06:30`);
  return Number.isFinite(created) && now.getTime() < created + config.apiMaterialDownload.graceMinutes * 60000;
}

const docKey = (barcodeId, filename) => `${barcodeId}/${filename}`;

async function processCase({ caseRecord, input }) {
  const claim = input['api-claim-intake'];
  const scanId = scanIdFor(claim.tpaCaseNumber);
  const items = await listScanItems(scanId);
  const expected = items.reduce((n, item) => n + materialCount(item), 0);

  if (expected === 0) {
    if (withinGrace(claim.crtDate)) {
      return { wait: true, output: { scanId, reason: `No images in the console yet; waiting up to ${config.apiMaterialDownload.graceMinutes} min after the claim was created` } };
    }
    return {
      output: { scanId, fileCount: 0, documents: [] },
      nextStatus: 'API_NO_DOCUMENTS',
      message: `No images in the console for ${scanId}; the customer will be asked for documents`,
    };
  }

  // Existing documents are skipped, never replaced; only submissions still missing pages are
  // downloaded (a retry after a partial download fetches just those).
  const stored = await CaseDocument.findAll({ where: { caseId: caseRecord.id } });
  const have = new Set(stored.map((d) => docKey(d.barcodeId, d.originalFilename)));
  const storedPerBarcode = (barcodeId) => stored.filter((d) => d.barcodeId === barcodeId).length;
  const incomplete = items.filter((item) => storedPerBarcode(item.barcodeId) < materialCount(item));

  const storage = getStorageAdapter();
  const barcodeIds = new Set(items.map((item) => item.barcodeId));
  const itemByBarcode = new Map(items.map((item) => [item.barcodeId, item]));
  for (const batch of zipBatches(incomplete)) {
    for (const file of await readZip(await downloadZip(scanId, batch), scanId, barcodeIds)) {
      if (have.has(docKey(file.barcodeId, file.filename))) continue;
      const { storageRef } = await storage.put(`api/${scanId}/${file.barcodeId}/${file.filename}`, file.bytes);
      stored.push(await CaseDocument.create({
        caseId: caseRecord.id,
        origin: 'CONSOLE',
        barcodeId: file.barcodeId,
        scanId: itemByBarcode.get(file.barcodeId).scanId,
        originalFilename: file.filename,
        contentType: CONTENT_TYPES[path.extname(file.filename).toLowerCase()] || null,
        sizeBytes: file.bytes.length,
        storageRef,
      }));
      have.add(docKey(file.barcodeId, file.filename));
    }
  }

  const documents = items.map((item) => ({
    barcodeId: item.barcodeId,
    scanId: item.scanId,
    createdAt: item.createdAt,
    expected: materialCount(item),
    documentIds: stored.filter((d) => d.barcodeId === item.barcodeId).map((d) => d.id),
  }));
  const fileCount = documents.reduce((n, d) => n + d.documentIds.length, 0);
  const output = { scanId, fileCount, documents };

  // Partial download (some images failed): keep what arrived, retry the rest next run instead of
  // continuing with missing pages (S5).
  if (fileCount < expected) {
    return { wait: true, output: { ...output, reason: `${fileCount} of ${expected} images downloaded; retrying the rest` } };
  }
  return {
    output,
    nextStatus: 'API_MATERIALS_DOWNLOADED',
    message: `${fileCount} image(s) from ${documents.length} console submission(s) stored`,
  };
}

const job = {
  name: JOB,
  inputStatus: 'API_RECEIVED',
  inputs: ['api-claim-intake'],
  batchLimit: config.apiMaterialDownload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, scanIdFor, belongsToScan, zipBatches, readZip, withinGrace };
