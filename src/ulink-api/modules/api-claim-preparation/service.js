const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase } = require('../ias-claim-preparation/service');

// api-claim-preparation: API case workflow job (docs/imp/day1/api-case-workflow.md section 6.6).
//
//   input:  { 'api-claim-intake': { clNo, tpaCaseNumber }, 'api-material-download': { documents },
//             'api-claim-recognition': { extractedFields, recognizedType },
//             'api-member-verification': { iasMemberInfoResponse },
//             'api-document-checking': { outcome, checkedAt } }
//   output: { payload, documentsComplete, diagnosis, lines, isStp, claimPrepMeta }
//
// The email flow's own claim preparation, unchanged: ias-claim-preparation's checkCase does the
// ICD-10 diagnosis pick, the per-voucher benefit picks, STP eligibility and builds the CL_CLAIM_API
// payload. It reads a handful of case fields, which come here from the earlier jobs' outputs.
//
// Unlike email cases, an API case reaches this job whether or not its documents passed: the claim
// already exists in IAS, and missing documents are marked on it as a suspense (isSuspense=Y) while
// the customer is asked for them. The payload then becomes the IAS claim revision body
// (docs/imp/demo/API DAY1/IAS_CLAIM_REVISION.md): the same fields plus claimNo, the API flags
// below, and every console barcode.

const MAX_BARCODES = 6; // barcode + suppBarcode1..5

// The case's console submissions, earliest first (the middleware lists newest first): the first
// goes in `barcode`, the next five in suppBarcode1..5; unused slots are null; more than six are
// left out (confirmed 2026-09-24).
function barcodeFields(documents) {
  const ids = [...documents]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((d) => d.barcodeId)
    .slice(0, MAX_BARCODES);
  const fields = { barcode: ids[0] ?? null };
  for (let i = 1; i < MAX_BARCODES; i += 1) fields[`suppBarcode${i}`] = ids[i] ?? null;
  return fields;
}

// API flags (confirmed 2026-09-24). Missing documents always mean a suspense, even for an STP
// amount. isSuspense is sent every time: IAS sets the suspense on Y and lifts it on N, so the
// revision after the customer's documents arrive clears it.
function apiFlags({ isStp, documentsComplete }) {
  if (!documentsComplete) return { isValidation: 'Y', isCSR: 'N', isSuspense: 'Y' };
  if (isStp) return { isValidation: 'Y', isCSR: 'Y', isSuspense: 'N' };
  return { isValidation: 'N', isCSR: 'N', isSuspense: 'N' };
}

async function processCase({ caseRecord, input }) {
  const claim = input['api-claim-intake'];
  const { extractedFields, recognizedType } = input['api-claim-recognition'];
  const documentCheck = input['api-document-checking'];
  const documentsComplete = documentCheck.outcome === 'DOCUMENT_CHECKED';
  const { barcode, ...suppBarcodes } = barcodeFields(input['api-material-download'].documents);

  const prepared = await checkCase({
    id: caseRecord.id,
    extractedFields,
    recognizedType,
    iasMemberInfoResponse: input['api-member-verification'].iasMemberInfoResponse,
    createdAt: caseRecord.createdAt,
    consoleBarcode: barcode,
    // Documents aren't complete yet on a suspended claim, so no completion date.
    consoleUploadResult: { completedAt: documentsComplete ? documentCheck.checkedAt : null },
  });

  const payload = {
    ...prepared.payload,
    claimNo: claim.clNo,
    TpaCaseNumber: claim.tpaCaseNumber,
    ...suppBarcodes,
    ...apiFlags({ isStp: prepared.isStp, documentsComplete }),
  };

  return {
    output: {
      payload,
      documentsComplete,
      diagnosis: prepared.diagnosis,
      lines: prepared.lines,
      isStp: prepared.isStp,
      claimPrepMeta: prepared.claimPrepMeta,
    },
    nextStatus: 'API_CLAIM_PAYLOAD_PREPARED',
    message: `Claim ${claim.clNo} revision prepared (${prepared.lines.length} line(s), STP: ${prepared.isStp ? 'yes' : 'no'}, `
      + `documents ${documentsComplete ? 'complete' : 'incomplete → suspense'})`,
  };
}

const job = {
  name: 'api-claim-preparation',
  // Both document-check outcomes continue here (incomplete → isSuspense=Y).
  inputStatus: ['API_DOCUMENTS_VERIFIED', 'API_INCOMPLETE'],
  inputs: ['api-claim-intake', 'api-material-download', 'api-claim-recognition', 'api-member-verification', 'api-document-checking'],
  batchLimit: config.iasClaimPreparation.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, barcodeFields, apiFlags };
