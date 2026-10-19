const { CaseDocument } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { uploadToConsole, UploadRejected } = require('../console-upload/clUploadClient');
const { scanIdFromPath } = require('../console-upload/service');

// api-console-upload: after the document check, sends each case-page upload not in the IAS console yet (one merged
// PDF per upload, modules/case-upload) through cl-upload — like the email flow's console-upload. The IAS revision
// needs every console barcode, so the case then waits for the barcodes (api-console-barcode). Nothing to send: on to
// claim preparation in the same run.
//
//   input:  { 'api-claim-intake': { tpaCaseNumber }, 'api-console-upload'?: own last output }
//   output: { uploads: [{ documentId, scanId, uploadedAt, path }] }   (every upload sent so far)
//
// The case documents (origin UPLOAD) are the record of what was sent: each one gets its console scan id
// (API-<TpaCaseNumber>-NN) as soon as cl-upload accepts it, so a failure later in the run never sends it twice. Those
// scan ids are ours: api-console-watch and api-material-download never take them again (api-material-download
// ownScanIds), because the case already read the stored PDF.

const JOB = 'api-console-upload';

async function processCase({ caseRecord, input }) {
  const { tpaCaseNumber } = input['api-claim-intake'];
  const documents = await CaseDocument.findAll({ where: { caseId: caseRecord.id, origin: 'UPLOAD' }, order: [['createdAt', 'ASC']] });
  const earlier = new Map((input[JOB]?.uploads || []).map((u) => [u.documentId, u]));
  // Sent before (also in a run that failed later): kept with its upload time if known.
  const uploads = documents.filter((d) => d.scanId).map((d) => earlier.get(d.id) || { documentId: d.id, scanId: d.scanId, uploadedAt: new Date().toISOString(), path: null });
  const pending = documents.filter((d) => !d.scanId);
  const sent = uploads.filter((u) => !earlier.has(u.documentId)).map((u) => u.scanId);
  if (pending.length === 0 && sent.length === 0) {
    return { output: { uploads }, nextStatus: 'API_READY_FOR_CLAIM_PREPARATION', message: 'No case-page upload to send to the console' };
  }

  const storage = getStorageAdapter();
  for (const document of pending) {
    const uploadedAt = new Date().toISOString();
    let path;
    try {
      ({ path } = await uploadToConsole({ tpaCaseNumber, pdf: await storage.get(document.storageRef), filename: document.originalFilename }));
    } catch (error) {
      if (!(error instanceof UploadRejected)) throw error; // technical: retried next run; uploads already sent are kept
      return {
        output: { uploads, reasonCode: 'CONSOLE_UPLOAD_REFUSED', message: error.message },
        nextStatus: 'API_CONSOLE_UPLOAD_FAILED',
        message: `The console refused ${document.originalFilename}: ${error.message}`,
      };
    }
    const scanId = scanIdFromPath(path, tpaCaseNumber);
    if (!scanId) {
      // In the console, but its barcode can't be told apart from other submissions of the case number.
      return {
        output: { uploads, reasonCode: 'CONSOLE_SCAN_ID_UNKNOWN', message: `cl-upload answered path ${path}` },
        nextStatus: 'API_CONSOLE_UPLOAD_FAILED',
        message: `${document.originalFilename} is in the console, but its path (${path}) shows no API-${tpaCaseNumber}-NN scan id; check the console`,
      };
    }
    await document.update({ scanId });
    uploads.push({ documentId: document.id, scanId, uploadedAt, path });
    sent.push(scanId);
  }
  return {
    output: { uploads },
    nextStatus: 'API_CONSOLE_BARCODE_PENDING',
    message: `Sent ${sent.length} case-page upload(s) to the console (${sent.join(', ')}); waiting for the barcode`,
  };
}

const job = {
  name: JOB,
  // Both document-check outcomes (and a person's override / request) come here before claim preparation.
  inputStatus: ['API_DOCUMENTS_VERIFIED', 'API_INCOMPLETE'],
  inputs: ['api-claim-intake'],
  optionalInputs: [JOB],
  batchLimit: config.consoleUpload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
