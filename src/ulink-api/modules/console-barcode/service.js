const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { listBarcodes } = require('../api-material-download/middlewareClient');
const { queueConsoleUploadIssue } = require('../console-upload/service');
const { describeBarcodes } = require('../shared/barcodeFields');

// console-barcode: email cases uploaded by cl-upload wait here for the console to create their barcode
// (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md). Like ordering food and waiting
// for the ticket to be called: the console's barcode job runs about every 15 minutes, so each pipeline
// run asks the console middleware for the case's barcodes (scanId API-<TpaCaseNumber>) until ours is there.
//
//   CONSOLE_BARCODE_PENDING → DOCUMENTS_UPLOADED       barcode found (ias-claim-preparation picks it up)
//                           → CONSOLE_BARCODE_MISSING  none within config.clUpload.barcodeWaitMinutes
//   CONSOLE_BARCODE_MISSING → DOCUMENTS_UPLOADED       found later — still checked every run

const BLOCK_NAME = 'console-barcode';

// Clocks differ between our server and the console's; a barcode stamped a little before our own upload
// time is still ours. Barcodes from an earlier upload of the same case are far older.
const CLOCK_SLACK_MS = 5 * 60 * 1000;

/**
 * Pure. items: the middleware's barcodes for the case number (every upload of it: -01, -02, …).
 * - found: a barcode of OUR upload is there → every barcode of the case number, earliest first
 *   (the claim's barcode + suppBarcode1..5 — shared/barcodeFields.js)
 * - overdue: none yet and the wait is over; waiting: none yet.
 * Ours = the barcode with our upload's scanId (API-<TpaCaseNumber>-NN, from the upload response), so an
 * earlier upload's barcode — another case with the same case number — never lets ours go on early.
 * Uploads saved before scanId was kept: ours = created after our upload time.
 */
function decideBarcode({ items, uploadedAt, scanId, now, waitMinutes }) {
  const uploaded = new Date(uploadedAt).getTime();
  const sorted = [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const isOurs = scanId
    ? (item) => item.scanId === scanId
    : (item) => new Date(item.createdAt).getTime() >= uploaded - CLOCK_SLACK_MS;
  if (sorted.some(isOurs)) {
    return { state: 'found', barcodes: sorted.map(({ barcodeId, scanId, createdAt }) => ({ barcodeId, scanId, createdAt })) };
  }
  return { state: now.getTime() - uploaded > waitMinutes * 60 * 1000 ? 'overdue' : 'waiting' };
}

async function logEvent(transaction, { caseId, prevStatus, newStatus, reasonCode = null, message }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

async function checkCase(caseRecord, now = new Date()) {
  const upload = caseRecord.consoleUploadResult || {};
  const { items = [] } = await listBarcodes(`API-${upload.tpaCaseNumber}`);
  const decision = decideBarcode({ items, uploadedAt: upload.uploadedAt, scanId: upload.scanId, now, waitMinutes: config.clUpload.barcodeWaitMinutes });
  const prevStatus = caseRecord.currentStatus;

  if (decision.state === 'found') {
    const [first] = decision.barcodes;
    await sequelize.transaction(async (transaction) => {
      await Case.update(
        {
          currentStatus: 'DOCUMENTS_UPLOADED',
          consoleBarcode: first.barcodeId,
          consoleUploadResult: { ...upload, barcodes: decision.barcodes, barcodeAt: now.toISOString() },
        },
        { where: { id: caseRecord.id }, transaction }
      );
      await logEvent(transaction, {
        caseId: caseRecord.id,
        prevStatus,
        newStatus: 'DOCUMENTS_UPLOADED',
        message: `Console barcode received: ${describeBarcodes(decision.barcodes, upload.scanId)}`,
      });
    });
    return 'found';
  }

  // Overdue: flagged for review once (with an internal email); an already-flagged case just keeps being checked.
  if (decision.state === 'overdue' && prevStatus !== 'CONSOLE_BARCODE_PENDING') return 'overdue';
  if (decision.state === 'overdue') {
    const minutes = Math.round((now.getTime() - new Date(upload.uploadedAt).getTime()) / 60000);
    const detail = `Uploaded to the console as ${upload.file} ${minutes} minutes ago (scan id ${upload.scanId || `API-${upload.tpaCaseNumber}`}); no barcode for it yet. The console normally creates it within 15-30 minutes. The system keeps checking every run.`;
    await sequelize.transaction(async (transaction) => {
      await Case.update({ currentStatus: 'CONSOLE_BARCODE_MISSING' }, { where: { id: caseRecord.id }, transaction });
      await logEvent(transaction, { caseId: caseRecord.id, prevStatus, newStatus: 'CONSOLE_BARCODE_MISSING', reasonCode: 'CONSOLE_BARCODE_MISSING', message: detail });
      await queueConsoleUploadIssue(transaction, caseRecord, { status: 'CONSOLE_BARCODE_MISSING', problem: 'Console barcode not received', detail });
    });
    return 'overdue';
  }
  return 'waiting'; // normal: left as it is, checked again next run
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: ['CONSOLE_BARCODE_PENDING', 'CONSOLE_BARCODE_MISSING'] },
    order: [['updatedAt', 'ASC']],
  });
  const results = [];
  for (const caseRecord of cases) {
    try {
      results.push({ caseId: caseRecord.id, ok: true, state: await checkCase(caseRecord) });
    } catch (error) {
      // Middleware down / timeout: nothing changes, checked again next run.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }
  return {
    processed: results.filter((r) => r.ok && r.state !== 'waiting').length,
    waiting: results.filter((r) => r.state === 'waiting').length,
    errors: results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error })),
  };
}

module.exports = { run, checkCase, decideBarcode };
