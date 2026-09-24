const { CaseDocument, ClaimRoute, EmailAttachment } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { transcribePages, extractFields } = require('../claim-recognition/service');

// api-claim-recognition: API case workflow job 3 (docs/imp/day1/api-case-workflow.md section 6.4).
//
//   input:  { 'api-material-download': { scanId, fileCount, documents: [{ barcodeId, documentIds }] },
//             'api-reply-intake': { attachmentIds } }        (only once the customer has replied)
//   output: { recognizedType, extractedFields, pageCount, transcripts }   (or reasonCode/message on review)
//
// Reads the case's console images with exactly the email flow's OCR: the same page-transcription
// prompt (transcribePages) and the same field extraction + post-processing (extractFields: invoice
// dedupe, DOB/delegation normalisation, medical-record fallback) under the same route's schema.
// The one difference: API claims are always AYAS member claims (confirmed 2026-09-24), so there is
// no route decision — the case can't come out "not recognized".

const JOB = 'api-claim-recognition';
const API_ROUTE_KEY = 'ayas_member_claim';
// A long email thread keeps adding reply attachments, and every page goes into one extraction
// prompt. Past this, a person should look instead (S21).
// ponytail: fixed page cap; cache per-page transcripts and trim duplicates if real threads hit it.
const MAX_PAGES = 60;

async function processCase({ caseRecord, input }) {
  const route = await ClaimRoute.findOne({ where: { routeKey: API_ROUTE_KEY, enabled: true } });
  if (!route) throw new Error(`Claim route ${API_ROUTE_KEY} is missing or disabled (ulink_claim_routes)`);

  const documentIds = input['api-material-download'].documents.flatMap((d) => d.documentIds);
  const documents = await CaseDocument.findAll({
    where: { caseId: caseRecord.id, id: documentIds },
    order: [['barcodeId', 'ASC'], ['originalFilename', 'ASC']],
  });
  if (documents.length !== documentIds.length) {
    throw new Error(`Expected ${documentIds.length} case documents, found ${documents.length}`);
  }

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
  for (const doc of documents) await read(`${doc.barcodeId}/${doc.originalFilename}`, doc.storageRef, doc.originalFilename, doc.id);
  for (const [i, att] of attachments.entries()) {
    await read(`reply-${i + 1}/${att.originalFilename || 'attachment'}`, att.storageRef, att.originalFilename, att.id);
  }

  if (transcripts.length > MAX_PAGES) {
    return {
      output: { recognizedType: API_ROUTE_KEY, reasonCode: 'TOO_MANY_PAGES', message: `${transcripts.length} pages (max ${MAX_PAGES})`, pageCount: transcripts.length },
      nextStatus: 'API_MANUAL_REVIEW',
      message: `${transcripts.length} pages across console images and replies — too many to read in one pass; needs an operator`,
    };
  }

  const { extractedFields, schemaValidationError } = await extractFields(transcripts, route);
  if (schemaValidationError) {
    return {
      output: { recognizedType: API_ROUTE_KEY, reasonCode: 'SCHEMA_VALIDATION_FAILED', message: schemaValidationError, transcripts },
      nextStatus: 'API_MANUAL_REVIEW',
      message: `Extraction didn't match the ${API_ROUTE_KEY} schema; needs an operator: ${schemaValidationError}`,
    };
  }
  return {
    output: { recognizedType: API_ROUTE_KEY, extractedFields, pageCount: transcripts.length, transcripts },
    nextStatus: 'API_RECOGNIZED',
    message: `${transcripts.length} page(s) read as ${API_ROUTE_KEY}`,
  };
}

const job = {
  name: JOB,
  // A customer reply with new attachments sends the case back here (API_REPLY_RECEIVED).
  inputStatus: ['API_MATERIALS_DOWNLOADED', 'API_REPLY_RECEIVED'],
  inputs: ['api-material-download'],
  optionalInputs: ['api-reply-intake'],
  // Same cost profile as the email OCR job (vision call per page + extraction), same batch size.
  batchLimit: config.claimRecognition.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
