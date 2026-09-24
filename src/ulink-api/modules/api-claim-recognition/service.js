const { CaseDocument, ClaimRoute } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { transcribePages, extractFields } = require('../claim-recognition/service');

// api-claim-recognition: API case workflow job 3 (docs/imp/day1/api-case-workflow.md section 6.4).
//
//   input:  { 'api-material-download': { scanId, fileCount, documents: [{ barcodeId, documentIds }] } }
//   output: { recognizedType, extractedFields, pageCount, transcripts }   (or reasonCode/message on review)
//
// Reads the case's console images with exactly the email flow's OCR: the same page-transcription
// prompt (transcribePages) and the same field extraction + post-processing (extractFields: invoice
// dedupe, DOB/delegation normalisation, medical-record fallback) under the same route's schema.
// The one difference: API claims are always AYAS member claims (confirmed 2026-09-24), so there is
// no route decision — the case can't come out "not recognized".

const JOB = 'api-claim-recognition';
const API_ROUTE_KEY = 'ayas_member_claim';

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

  // Same "[<file> - page N]" chunk labels as email attachments — the medical-record fallback
  // groups pages by that label. The barcode is part of the name because every console
  // submission numbers its pages from page-000.jpg.
  const storage = getStorageAdapter();
  const transcripts = [];
  for (const doc of documents) {
    const name = `${doc.barcodeId}/${doc.originalFilename}`;
    const pages = await transcribePages(await storage.get(doc.storageRef), doc.originalFilename, doc.id);
    for (const page of pages) transcripts.push(`[${name} - page ${page.pageNumber}]\n${page.text}`);
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
  inputStatus: 'API_MATERIALS_DOWNLOADED',
  inputs: ['api-material-download'],
  // Same cost profile as the email OCR job (vision call per page + extraction), same batch size.
  batchLimit: config.claimRecognition.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
