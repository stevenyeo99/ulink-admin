const { CaseDocument } = require('../../db/models');
const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { scanIdFor, listScanItems, ownScanIds, materialCount } = require('../api-material-download/service');

// api-console-watch (SYSTEM_4 E4-04): for an API case waiting on documents, looks in the IAS console for a submission
// the case doesn't have yet, put in the console by anyone. Our own case-page uploads (api-console-upload) are skipped:
// the case read them before they went to the console. Found: the case goes to API_NEW_DOCUMENTS, api-material-download fetches what's new, and the case is read and checked again;
// complete, the next IAS revision lifts the suspense. Nothing new: the case keeps waiting (checked every run).
//
//   input:  { 'api-claim-intake': { tpaCaseNumber }, 'case-upload'?: { uploadedAt }, 'api-console-upload'?: { uploads } }
//   output: { scanId, newBarcodes }  or (waiting) { scanId, reason }
//
// One middleware call per waiting case per run. API_DOCUMENTS_UPLOADED / API_UPLOAD_NOT_IN_CONSOLE: cases uploaded from
// the case page before uploads were read first (2026-10-19) still finish here; an upload that hasn't appeared after
// CONSOLE_BARCODE_WAIT_MINUTES goes to API_UPLOAD_NOT_IN_CONSOLE for a person — and is still watched. Remove these two
// once no case is at them.

const JOB = 'api-console-watch';

// Waiting on documents (owner, Q12): none received, incomplete (suspended in IAS), held for a person's check, and our
// own upload waiting for the console.
const WATCHED_STATUSES = ['API_NO_DOCUMENTS', 'API_CLAIM_SUSPENDED', 'API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE', 'API_DOCUMENTS_UPLOADED', 'API_UPLOAD_NOT_IN_CONSOLE'];

async function processCase({ caseRecord, input }) {
  const scanId = scanIdFor(input['api-claim-intake'].tpaCaseNumber);
  const items = await listScanItems(scanId);
  const stored = new Set((await CaseDocument.findAll({ where: { caseId: caseRecord.id }, attributes: ['barcodeId'] })).map((d) => d.barcodeId));
  const own = ownScanIds(input);
  const newItems = items.filter((item) => item.barcodeId && !stored.has(item.barcodeId) && !own.has(item.scanId) && materialCount(item) > 0);

  if (newItems.length) {
    const newBarcodes = newItems.map((item) => item.barcodeId);
    return {
      output: { scanId, newBarcodes },
      nextStatus: 'API_NEW_DOCUMENTS',
      message: `New documents in the console (${newItems.map((i) => `${i.scanId} ${i.barcodeId}`).join(', ')}); downloading and checking the case again`,
    };
  }

  const uploadedAt = input['case-upload']?.uploadedAt;
  if (caseRecord.currentStatus === 'API_DOCUMENTS_UPLOADED' && uploadedAt
    && Date.now() - Date.parse(uploadedAt) > config.clUpload.barcodeWaitMinutes * 60000) {
    return {
      output: { scanId, uploadedAt },
      nextStatus: 'API_UPLOAD_NOT_IN_CONSOLE',
      message: `The upload of ${uploadedAt} is not in the console after ${config.clUpload.barcodeWaitMinutes} minutes; check the console`,
    };
  }
  return { wait: true, output: { scanId, reason: 'No new documents in the console yet' } };
}

const job = {
  name: JOB,
  inputStatus: WATCHED_STATUSES,
  inputs: ['api-claim-intake'],
  optionalInputs: ['case-upload', 'api-console-upload'],
  batchLimit: config.apiMaterialDownload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, WATCHED_STATUSES };
