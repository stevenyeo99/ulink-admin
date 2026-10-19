const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { scanIdFor, listScanItems } = require('../api-material-download/service');
const { decideBarcode } = require('../console-barcode/service');

// api-console-barcode: the console creates a barcode for each upload later (about every 15 minutes). Each run looks
// for the barcodes of every case-page upload api-console-upload sent, like the email flow's console-barcode. All
// there: on to claim preparation, which sends them to IAS with the console's own barcodes.
//
//   input:  { 'api-claim-intake': { tpaCaseNumber }, 'api-console-upload': { uploads: [{ scanId, uploadedAt }] } }
//   output: { barcodes: [{ barcodeId, scanId, createdAt }] }   (our uploads' barcodes, every round)
//
// None after CONSOLE_BARCODE_WAIT_MINUTES: API_CONSOLE_BARCODE_MISSING for a person — and still checked every run.

const JOB = 'api-console-barcode';

async function processCase({ caseRecord, input }) {
  const { uploads } = input['api-console-upload'];
  // A submission the console listed before its barcode job ran has no barcode yet.
  const items = (await listScanItems(scanIdFor(input['api-claim-intake'].tpaCaseNumber))).filter((i) => i.barcodeId);
  const now = new Date();
  const states = uploads.map((u) => decideBarcode({ items, uploadedAt: u.uploadedAt, scanId: u.scanId, now, waitMinutes: config.clUpload.barcodeWaitMinutes }).state);

  if (states.every((s) => s === 'found')) {
    const ours = new Set(uploads.map((u) => u.scanId));
    const barcodes = items.filter((i) => ours.has(i.scanId)).map(({ barcodeId, scanId, createdAt }) => ({ barcodeId, scanId, createdAt }));
    return {
      output: { barcodes },
      nextStatus: 'API_READY_FOR_CLAIM_PREPARATION',
      message: `Console barcode(s) received: ${barcodes.map((b) => `${b.barcodeId} (${b.scanId})`).join(', ')}`,
    };
  }
  const waitingFor = uploads.filter((_, i) => states[i] !== 'found').map((u) => u.scanId).join(', ');
  if (states.includes('overdue') && caseRecord.currentStatus === 'API_CONSOLE_BARCODE_PENDING') {
    return {
      output: { waitingFor },
      nextStatus: 'API_CONSOLE_BARCODE_MISSING',
      message: `No console barcode for ${waitingFor} after ${config.clUpload.barcodeWaitMinutes} minutes; check the console. The system keeps checking every run.`,
    };
  }
  return { wait: true, output: { reason: `No console barcode yet for ${waitingFor}` } };
}

const job = {
  name: JOB,
  inputStatus: ['API_CONSOLE_BARCODE_PENDING', 'API_CONSOLE_BARCODE_MISSING'],
  inputs: ['api-claim-intake', 'api-console-upload'],
  batchLimit: config.apiMaterialDownload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
