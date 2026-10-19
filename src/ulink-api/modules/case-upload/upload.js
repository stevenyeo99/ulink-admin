const crypto = require('crypto');
const { sequelize, Case, CaseEvent, CaseDocument, ApiCaseStep } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { mergeToPdf } = require('../console-upload/mergePdf');

// Upload missing documents from the case page (SYSTEM_4 E4-04): a person — any logged-in user (owner, Q2) — adds the
// documents the customer gave them. The files of one upload are merged into one PDF and stored on the case (origin
// UPLOAD, no barcode yet), and the case is read and checked again at once (API_UPLOAD_RECEIVED → api-claim-recognition).
// After the document check, api-console-upload sends each upload's PDF to the IAS console (cl-upload, owner Q1) and
// api-console-barcode waits for its barcode before the IAS claim is revised. API cases waiting on documents only
// (owner Q12).

// Waiting on documents: none received, suspended in IAS, or held for a person's check.
const UPLOADABLE_STATUSES = ['API_NO_DOCUMENTS', 'API_CLAIM_SUSPENDED', 'API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE'];

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED = /\.(pdf|jpe?g|png)$/i;

// A business answer the person can act on (wrong file, wrong case status, the console said no) — shown to them, the
// case unchanged. status: the HTTP status to answer with.
class UploadRefused extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// files: [{ filename, contentType, bytes }]. Returns { status: 'API_UPLOAD_RECEIVED', files }.
async function uploadDocuments(caseRecord, files, { operator, username, comment }) {
  if (caseRecord.source !== 'API' || !UPLOADABLE_STATUSES.includes(caseRecord.currentStatus)) {
    throw new UploadRefused('Documents can be uploaded only for an API case waiting on documents (no documents, documents incomplete, or a documents check).');
  }
  if (!caseRecord.tpaCaseNumber) throw new UploadRefused('This case has no TPA case number, so the console cannot take an upload for it.');
  if (!files.length || files.length > MAX_FILES) throw new UploadRefused(`Choose 1 to ${MAX_FILES} files.`);
  const wrong = files.filter((f) => !ALLOWED.test(f.filename || ''));
  if (wrong.length) throw new UploadRefused(`Only PDF, JPG or PNG files: ${wrong.map((f) => f.filename || '(unnamed)').join(', ')}.`);
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new UploadRefused(`The files are ${(total / 1048576).toFixed(1)} MB together; the limit is 20 MB.`, 413);
  // Checked now, not only when api-console-upload sends it: otherwise the case would be read and then stuck.
  if (!config.clUpload.url || !config.clUpload.apiKey) throw new UploadRefused('Console upload is not set up on this server (CL_UPLOAD_URL / CL_UPLOAD_API_KEY).', 503);

  const { pdf, pageCount, skipped } = await mergeToPdf(files);
  if (skipped.length) throw new UploadRefused(`These files could not be read: ${skipped.join(', ')}.`);

  const uploadedAt = new Date();
  // [A-Za-z0-9._-] only, like every stored document name (getDocument sends it as the download name).
  const filename = `UPLOAD-${caseRecord.tpaCaseNumber}-${uploadedAt.toISOString().slice(0, 19).replace(/:/g, '')}.pdf`;
  // A random key: two uploads in the same second never overwrite each other.
  const { storageRef } = await getStorageAdapter().put(`api/${caseRecord.tpaCaseNumber}/upload/${crypto.randomUUID()}.pdf`, pdf);

  const names = files.map((f) => f.filename);
  const prevStatus = caseRecord.currentStatus;
  await sequelize.transaction(async (transaction) => {
    const [moved] = await Case.update({ currentStatus: 'API_UPLOAD_RECEIVED' }, { where: { id: caseRecord.id, currentStatus: UPLOADABLE_STATUSES }, transaction });
    if (moved !== 1) throw new UploadRefused('The case moved on while you were uploading; reload the page and try again.', 409);
    const document = await CaseDocument.create({
      caseId: caseRecord.id, origin: 'UPLOAD', barcodeId: null, originalFilename: filename,
      contentType: 'application/pdf', sizeBytes: pdf.length, storageRef,
    }, { transaction });
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: 'case-upload', status: 'DONE',
      input: { username, comment, files: names },
      output: { uploadedAt: uploadedAt.toISOString(), documentId: document.id, files: names, pageCount },
      startedAt: uploadedAt, finishedAt: new Date(),
    }, { transaction });
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus: 'API_UPLOAD_RECEIVED', reasonCode: 'DOCUMENTS_UPLOADED',
      message: `Documents uploaded by ${operator} — comment: ${comment} (${names.join(', ')}, ${pageCount} page${pageCount === 1 ? '' : 's'}); read and checked next, then sent to the IAS console`,
    }, { transaction });
  });
  return { status: 'API_UPLOAD_RECEIVED', files: names };
}

module.exports = { uploadDocuments, UploadRefused, UPLOADABLE_STATUSES, MAX_FILES, MAX_TOTAL_BYTES };
