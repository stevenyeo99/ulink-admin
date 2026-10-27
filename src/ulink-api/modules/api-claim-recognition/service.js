const { CaseDocument, ClaimRoute, EmailAttachment } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { transcribePages, extractFields } = require('../claim-recognition/service');
const { DocumentsTooLongError } = require('../claim-recognition/llmClient');

// api-claim-recognition: API case workflow job 3 (docs/imp/day1/api-case-workflow.md section 6.4).
//
//   input:  { 'api-material-download': { scanId, fileCount, documents: [{ barcodeId, documentIds }] },
//             'api-reply-intake': { attachmentIds } }        (only once the customer has replied)
//           + every case-page upload (case documents with origin UPLOAD, modules/case-upload)
//   output: { recognizedType, extractedFields, pageCount, transcripts, email }   (or reasonCode/message on review)
//
// Reads the case's console images with exactly the email flow's OCR: the same page-transcription
// prompt (transcribePages) and the same field extraction + post-processing (extractFields: invoice
// dedupe, DOB/delegation normalisation, medical-record fallback) under the same route's schema.
// The one difference: API claims are always AYAS member claims (confirmed 2026-09-24), so there is
// no route decision — the case can't come out "not recognized".

const JOB = 'api-claim-recognition';
const API_ROUTE_KEY = 'ayas_member_claim';
// No page cap (removed 2026-10-19): the size check below is the one limit — a claim too long for the model goes to a
// person (DOCUMENTS_TOO_LONG). A 60-page cap stopped AYA-CL-26040093 (62 pages, about 12,000 tokens of text, which
// fits) after every page had already been read.

async function processCase({ caseRecord, input }) {
  const route = await ClaimRoute.findOne({ where: { routeKey: API_ROUTE_KEY, enabled: true } });
  if (!route) throw new Error(`Claim route ${API_ROUTE_KEY} is missing or disabled (ulink_claim_routes)`);

  const documentIds = input['api-material-download'].documents.flatMap((d) => d.documentIds);
  const consoleDocuments = await CaseDocument.findAll({
    where: { caseId: caseRecord.id, id: documentIds },
    order: [['barcodeId', 'ASC'], ['originalFilename', 'ASC']],
  });
  if (consoleDocuments.length !== documentIds.length) {
    throw new Error(`Expected ${documentIds.length} case documents, found ${consoleDocuments.length}`);
  }
  // Then every case-page upload so far, oldest first (never downloaded from the console: api-material-download ownScanIds).
  const uploads = await CaseDocument.findAll({ where: { caseId: caseRecord.id, origin: 'UPLOAD' }, order: [['createdAt', 'ASC']] });
  const documents = [...consoleDocuments, ...uploads];

  // Every reply attachment received so far (all rounds), read together with the console images.
  const replyAttachmentIds = input['api-reply-intake']?.attachmentIds || [];
  const attachments = replyAttachmentIds.length
    ? await EmailAttachment.findAll({ where: { id: replyAttachmentIds }, order: [['createdAt', 'ASC']] })
    : [];
  if (attachments.length !== replyAttachmentIds.length) {
    throw new Error(`Expected ${replyAttachmentIds.length} reply attachments, found ${attachments.length}`);
  }

  const storage = getStorageAdapter();
  const transcripts = [];
  // Same "[<file> - page N]" chunk labels as email attachments — the medical-record fallback
  // groups pages by that label. The barcode is part of the name because every console
  // submission numbers its pages from page-000.jpg; reply files get a reply-N prefix.
  const read = async (name, storageRef, filename, label) => {
    const pages = await transcribePages(await storage.get(storageRef), filename, label);
    for (const page of pages) transcripts.push(`[${name} - page ${page.pageNumber}]\n${page.text}`);
  };
  for (const doc of documents) await read(`${doc.barcodeId || 'upload'}/${doc.originalFilename}`, doc.storageRef, doc.originalFilename, doc.id);
  for (const [i, att] of attachments.entries()) {
    await read(`reply-${i + 1}/${att.originalFilename || 'attachment'}`, att.storageRef, att.originalFilename, att.id);
  }

  // Too long for the model's context (SYSTEM_4 E4-27): a person reads it — never a call with pages cut off.
  let extraction;
  try {
    extraction = await extractFields(transcripts, route);
  } catch (error) {
    if (!(error instanceof DocumentsTooLongError)) throw error;
    return {
      output: { recognizedType: API_ROUTE_KEY, reasonCode: 'DOCUMENTS_TOO_LONG', message: error.message, pageCount: transcripts.length, estimatedTokens: error.estimatedTokens },
      nextStatus: 'API_MANUAL_REVIEW',
      message: `${transcripts.length} page(s): ${error.message}`,
    };
  }
  const { extractedFields, schemaValidationError } = extraction;
  if (schemaValidationError) {
    return {
      output: { recognizedType: API_ROUTE_KEY, reasonCode: 'SCHEMA_VALIDATION_FAILED', message: schemaValidationError, transcripts },
      nextStatus: 'API_MANUAL_REVIEW',
      message: `Extraction didn't match the ${API_ROUTE_KEY} schema; needs an operator: ${schemaValidationError}`,
    };
  }
  return {
    output: {
      recognizedType: API_ROUTE_KEY,
      extractedFields,
      pageCount: transcripts.length,
      transcripts,
      // No claim-received acknowledgement for API cases (owner, 2026-10-21): the customer submitted through the
      // e-claim form, so only the email flow sends one.
    },
    nextStatus: 'API_RECOGNIZED',
    message: `${transcripts.length} page(s) read as ${API_ROUTE_KEY}`,
  };
}

const job = {
  name: JOB,
  // A customer reply with new attachments (API_REPLY_RECEIVED) or a case-page upload (API_UPLOAD_RECEIVED) sends the
  // case back here.
  inputStatus: ['API_MATERIALS_DOWNLOADED', 'API_REPLY_RECEIVED', 'API_UPLOAD_RECEIVED'],
  inputs: ['api-material-download'],
  optionalInputs: ['api-reply-intake'],
  // Same cost profile as the email OCR job (vision call per page + extraction), same batch size.
  batchLimit: config.claimRecognition.batchLimit,
  process: processCase,
};

module.exports = { run: (options) => runApiJob(job, options), job };
