const path = require('path');
const JSZip = require('jszip');
const { CaseDocument } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { datePathSegments } = require('../shared/datePathSegments');
const { listMaterials, downloadZip } = require('./middlewareClient');
const { mergeToPdf } = require('../console-upload/mergePdf');

// api-material-download: API case workflow job 2 (docs/imp/day1/api-case-workflow.md section 6.3).
//
//   input:  { 'api-claim-intake': { clNo, tpaCaseNumber, crtDate } }
//   output: { scanId, fileCount, documents: [{ barcodeId, scanId, createdAt, expected, documentIds }] }
//
// Downloads the case's console images through ulink-console-middleware's zip endpoint and stores each
// console submission (barcode) as one PDF case document, its images as pages in file order (owner,
// 2026-10-19: reviewers see one document per submission; recognition reads it page by page like any PDF).
// Cases downloaded before keep one document per image; both are read and shown.

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

// Our own case-page uploads (scanIds) for a case, from api-console-upload's last output: already stored and read, so
// never downloaded again or treated as new.
const ownScanIds = (input) => new Set((input['api-console-upload']?.uploads || []).map((u) => u.scanId).filter(Boolean));

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

// Still inside the grace period after ULINK received the claim? Counted from the case's own createdAt (our clock), not
// IAS's crtDate: crtDate has no time zone, and the UAT IAS writes it in UTC+7, not Myanmar time (2026-10-19) — so no
// time zone is guessed. Intake lists the day's claims every run, so a claim is received within one run of its creation.
function withinGrace(receivedAt, now = new Date()) {
  const received = new Date(receivedAt).getTime();
  return Number.isFinite(received) && now.getTime() < received + config.apiMaterialDownload.graceMinutes * 60000;
}

// The one PDF a console submission is stored as.
const pdfName = (barcodeId) => `${barcodeId}.pdf`;

// The console's own order (item.materials) where a file name matches it, else file-name order (page-2 before page-10).
function inConsoleOrder(item, files) {
  const position = new Map((item.materials || []).map((m, i) => [m.originalname, i]));
  const rank = (f) => (position.has(f.filename) ? position.get(f.filename) : Infinity);
  return [...files].sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1)
    || a.filename.localeCompare(b.filename, undefined, { numeric: true }));
}

// One submission as one PDF (owner, 2026-10-19). An image that can't go into a PDF (a broken file, a file name that
// doesn't match its content) must not stop the case: that submission is stored image by image instead, as before.
async function storeSubmission(storage, caseId, scanId, item, files) {
  const put = async (filename, bytes, contentType) => {
    // Under the day it is stored (yyyy/MM/dd, UTC, like every stored file).
    const { storageRef } = await storage.put(`${datePathSegments(new Date())}/api/${scanId}/${item.barcodeId}/${filename}`, bytes);
    return CaseDocument.create({
      caseId, origin: 'CONSOLE', barcodeId: item.barcodeId, scanId: item.scanId,
      originalFilename: filename, contentType, sizeBytes: bytes.length, storageRef,
    });
  };
  const typed = files.map((f) => ({ bytes: f.bytes, filename: f.filename, contentType: CONTENT_TYPES[path.extname(f.filename).toLowerCase()] || null }));
  let merged = null;
  try {
    merged = await mergeToPdf(typed, { imageDpi: config.claimRecognition.rasterDpi });
  } catch {
    merged = null;
  }
  if (merged && !merged.skipped.length) return [await put(pdfName(item.barcodeId), merged.pdf, 'application/pdf')];
  const docs = [];
  for (const f of typed) docs.push(await put(f.filename, f.bytes, f.contentType));
  return docs;
}

// ponytail: a submission is stored once — images the console adds later under the same barcode are not fetched (a
// barcode is one upload, so this is not expected); compare the PDF's page count with the console's if it happens.

// Customer email for a claim with no console images at all (S4) — the email flow's
// MISSING_DOCUMENTS template with one line. Placeholder wording, not from the approved
// canned-response set yet.
const NO_DOCUMENTS_EMAIL = {
  taskType: 'MISSING_DOCUMENTS',
  audience: 'customer',
  payload: { issues: ['We did not receive any claim documents. Please send your claim form, medical report(s) and voucher(s).'] },
  dedupeKey: 'NO_DOCUMENTS',
};

async function processCase({ caseRecord, input }) {
  const claim = input['api-claim-intake'];
  const scanId = scanIdFor(claim.tpaCaseNumber);
  // Our own case-page uploads are already stored and read; their barcodes come from api-console-barcode.
  const own = ownScanIds(input);
  const items = (await listScanItems(scanId)).filter((item) => !own.has(item.scanId));
  const expected = items.reduce((n, item) => n + materialCount(item), 0);

  if (expected === 0) {
    if (withinGrace(caseRecord.createdAt)) {
      return { wait: true, output: { scanId, reason: `No images in the console yet; waiting up to ${config.apiMaterialDownload.graceMinutes} min after ULINK received the claim` } };
    }
    return {
      output: { scanId, fileCount: 0, documents: [], email: NO_DOCUMENTS_EMAIL },
      nextStatus: 'API_NO_DOCUMENTS',
      message: `No images in the console for ${scanId}; the customer will be asked for documents`,
    };
  }

  // A submission is stored once: as its PDF, or (downloaded before 2026-10-19) as all its images. Stored ones are
  // never downloaded again; the rest are, whole.
  const stored = await CaseDocument.findAll({ where: { caseId: caseRecord.id } });
  const storedFor = (barcodeId) => stored.filter((d) => d.barcodeId === barcodeId);
  const isStored = (item) => {
    const docs = storedFor(item.barcodeId);
    return docs.some((d) => d.originalFilename === pdfName(item.barcodeId)) || docs.length >= materialCount(item);
  };
  const missing = items.filter((item) => materialCount(item) > 0 && !isStored(item));

  // Each zip batch holds whole submissions: they are stored as their batch arrives, so a later failure keeps them.
  // Only a complete submission is stored: one with an image missing is left for the next run (S5) — never a PDF with
  // pages missing.
  const barcodeIds = new Set(items.map((item) => item.barcodeId));
  const storage = getStorageAdapter();
  const incomplete = [];
  for (const batch of zipBatches(missing)) {
    const filesByBarcode = new Map();
    for (const file of await readZip(await downloadZip(scanId, batch), scanId, barcodeIds)) {
      filesByBarcode.set(file.barcodeId, [...(filesByBarcode.get(file.barcodeId) || []), file]);
    }
    for (const item of batch) {
      const files = inConsoleOrder(item, filesByBarcode.get(item.barcodeId) || []);
      if (files.length < materialCount(item)) {
        incomplete.push(`${item.barcodeId} (${files.length} of ${materialCount(item)} images)`);
        continue;
      }
      stored.push(...(await storeSubmission(storage, caseRecord.id, scanId, item, files)));
    }
  }

  const documents = items.map((item) => {
    const docs = storedFor(item.barcodeId);
    const pdfDoc = docs.find((d) => d.originalFilename === pdfName(item.barcodeId));
    return {
      barcodeId: item.barcodeId,
      scanId: item.scanId,
      createdAt: item.createdAt,
      expected: materialCount(item),
      documentIds: pdfDoc ? [pdfDoc.id] : docs.map((d) => d.id),
    };
  });
  const fileCount = documents.reduce((n, d) => n + d.documentIds.length, 0);
  const output = { scanId, fileCount, documents };

  // Partial download (some images failed): what is complete is stored, the rest is downloaded again next run instead
  // of continuing with missing pages (S5).
  if (incomplete.length) {
    return { wait: true, output: { ...output, reason: `Not all images downloaded yet: ${incomplete.join(', ')}; retrying` } };
  }
  return {
    output,
    nextStatus: 'API_MATERIALS_DOWNLOADED',
    message: `${expected} image(s) from ${documents.length} console submission(s) stored as ${documents.length} PDF document(s)`,
  };
}

const job = {
  name: JOB,
  // API_NEW_DOCUMENTS: new console documents for a case waiting on them (api-console-watch, SYSTEM_4 E4-04) —
  // the ones not stored yet are downloaded, and the case is read and checked again with all of them.
  inputStatus: ['API_RECEIVED', 'API_NEW_DOCUMENTS'],
  inputs: ['api-claim-intake'],
  optionalInputs: ['api-console-upload'],
  batchLimit: config.apiMaterialDownload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, scanIdFor, belongsToScan, listScanItems, ownScanIds, materialCount, zipBatches, readZip, withinGrace };
