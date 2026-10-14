const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');
const config = require('../../config');
const { mergeToPdf } = require('../console-upload/mergePdf');
const { uploadToConsole, UploadRejected } = require('../console-upload/clUploadClient');
const { WATCHED_STATUSES } = require('../api-console-watch/service');

// Upload missing documents from the case page (SYSTEM_4 E4-04): a person — any logged-in user (owner, Q2) — sends the
// documents the customer gave them to the IAS console (cl-upload, owner Q1). The console makes them the case's next
// submission (API-<TPA case number>-NN) with a barcode; api-console-watch then notices it and the case is read and
// checked again, and the IAS claim revised (the suspense lifted once complete, owner Q5). The console is the one source
// of documents, so nothing after it changes. API cases waiting on documents only (owner Q12).

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

// files: [{ filename, contentType, bytes }]. Returns { status: 'API_DOCUMENTS_UPLOADED', path, files }.
async function uploadDocuments(caseRecord, files, { operator, username, comment }) {
  if (caseRecord.source !== 'API' || !WATCHED_STATUSES.includes(caseRecord.currentStatus)) {
    throw new UploadRefused('Documents can be uploaded only for an API case waiting on documents (no documents, documents incomplete, or a documents check).');
  }
  if (!caseRecord.tpaCaseNumber) throw new UploadRefused('This case has no TPA case number, so the console cannot take an upload for it.');
  if (!files.length || files.length > MAX_FILES) throw new UploadRefused(`Choose 1 to ${MAX_FILES} files.`);
  const wrong = files.filter((f) => !ALLOWED.test(f.filename || ''));
  if (wrong.length) throw new UploadRefused(`Only PDF, JPG or PNG files: ${wrong.map((f) => f.filename || '(unnamed)').join(', ')}.`);
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new UploadRefused(`The files are ${(total / 1048576).toFixed(1)} MB together; the limit is 20 MB.`, 413);
  if (!config.clUpload.url || !config.clUpload.apiKey) throw new UploadRefused('Console upload is not set up on this server (CL_UPLOAD_URL / CL_UPLOAD_API_KEY).', 503);

  const { pdf, pageCount, skipped } = await mergeToPdf(files);
  if (skipped.length) throw new UploadRefused(`These files could not be read: ${skipped.join(', ')}.`);

  const uploadedAt = new Date();
  let path;
  try {
    ({ path } = await uploadToConsole({ tpaCaseNumber: caseRecord.tpaCaseNumber, pdf, filename: `UPLOAD ${caseRecord.tpaCaseNumber} ${uploadedAt.toISOString().slice(0, 10)}.pdf` }));
  } catch (error) {
    if (error instanceof UploadRejected) throw new UploadRefused(`The console refused the upload: ${error.message}`, 422);
    throw error; // technical: nothing changed; the person tries again
  }

  const names = files.map((f) => f.filename);
  const prevStatus = caseRecord.currentStatus;
  await sequelize.transaction(async (transaction) => {
    // Still waiting on documents (it may have moved meanwhile — then the console watch still sees the upload if the
    // case comes back to waiting; the record below keeps it either way).
    await Case.update({ currentStatus: 'API_DOCUMENTS_UPLOADED' }, { where: { id: caseRecord.id, currentStatus: WATCHED_STATUSES }, transaction });
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: 'case-upload', status: 'DONE',
      input: { username, comment, files: names },
      output: { uploadedAt: uploadedAt.toISOString(), path, files: names, pageCount },
      startedAt: uploadedAt, finishedAt: new Date(),
    }, { transaction });
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus: 'API_DOCUMENTS_UPLOADED', reasonCode: 'DOCUMENTS_UPLOADED',
      message: `Documents uploaded to the console by ${operator} — comment: ${comment} (${names.join(', ')}, ${pageCount} page${pageCount === 1 ? '' : 's'})`,
    }, { transaction });
  });
  return { status: 'API_DOCUMENTS_UPLOADED', path, files: names };
}

module.exports = { uploadDocuments, UploadRefused, MAX_FILES, MAX_TOTAL_BYTES };
