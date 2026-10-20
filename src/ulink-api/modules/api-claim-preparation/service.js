const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase } = require('../ias-claim-preparation/service');
const { barcodeFields } = require('../shared/barcodeFields');
const { openRequests } = require('../case-requests/requests');
const { getSettings } = require('../settings/settings');

// api-claim-preparation: API case workflow job (docs/imp/day1/api-case-workflow.md section 6.6).
//
//   input:  { 'api-claim-intake': { clNo, tpaCaseNumber }, 'api-material-download': { documents },
//             'api-claim-recognition': { extractedFields, recognizedType },
//             'api-member-verification': { iasMemberInfoResponse },
//             'api-document-checking': { outcome, checkedAt },
//             'api-console-barcode'?: { barcodes } }   (case-page uploads sent to the console)
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
  // A person overrode a held document check (API_DOCUMENTS_REVIEW → API_DOCUMENTS_VERIFIED): the documents are fine.
  // A reviewer's own line still open (SYSTEM_4 E4-28): not complete, whatever an earlier override said.
  const documentsComplete = (documentCheck.outcome === 'DOCUMENT_CHECKED' || input['case-override']?.from === 'API_DOCUMENTS_REVIEW')
    && (await openRequests(caseRecord.id)).length === 0;
  // The console's own submissions plus our case-page uploads (api-material-download never downloads those).
  const { barcode, ...suppBarcodes } = barcodeFields([...input['api-material-download'].documents, ...(input['api-console-barcode']?.barcodes || [])]);

  const prepared = await checkCase({
    id: caseRecord.id,
    source: caseRecord.source,
    claimNo: claim.clNo,
    // For the AI summary sent to IAS (AiSummaryRemark): the member and document results so far.
    memberVerifyResult: input['api-member-verification'].memberVerifyResult,
    documentCheckResult: documentCheck.documentCheckResult,
    extractedFields,
    recognizedType,
    iasMemberInfoResponse: input['api-member-verification'].iasMemberInfoResponse,
    createdAt: caseRecord.createdAt,
    consoleBarcode: barcode,
    // Documents aren't complete yet on a suspended claim, so no completion date.
    consoleUploadResult: { completedAt: documentsComplete ? documentCheck.checkedAt : null },
    // A person chose the diagnosis code (POST /api/cases/:id/diagnosis): used as is, on every later preparation too.
    diagnosisChoice: input['diagnosis-review'] || null,
  });

  const payload = {
    ...prepared.payload,
    claimNo: claim.clNo,
    TpaCaseNumber: claim.tpaCaseNumber,
    ...suppBarcodes,
    ...apiFlags({ isStp: prepared.isStp, documentsComplete }),
  };

  const output = {
    payload,
    documentsComplete,
    diagnosis: prepared.diagnosis,
    lines: prepared.lines,
    isStp: prepared.isStp,
    claimPrepMeta: prepared.claimPrepMeta,
  };

  // The AI was unsure of the diagnosis code (switch holdUnsureDiagnosis, owner 2026-10-20): a person chooses it
  // before anything goes to IAS. Unsure = the default code, or at or below the AI confidence threshold.
  const diagnosis = prepared.claimPrepMeta?.diagnosis;
  if (diagnosis && !diagnosis.chosen) {
    const settings = await getSettings();
    const unsure = diagnosis.defaulted || (typeof diagnosis.confidence === 'number' && diagnosis.confidence <= settings.aiConfidenceThreshold);
    if (unsure && settings.holdUnsureDiagnosis) {
      return {
        output,
        nextStatus: 'API_DIAGNOSIS_REVIEW',
        message: `Claim ${claim.clNo}: the AI wasn't sure of the diagnosis code (${prepared.diagnosis?.diagCode ?? 'none'}); a person chooses it before the revision`,
      };
    }
  }

  return {
    output,
    nextStatus: 'API_CLAIM_PAYLOAD_PREPARED',
    message: `Claim ${claim.clNo} revision prepared (${prepared.lines.length} line(s), STP: ${prepared.isStp ? 'yes' : 'no'}, `
      + `documents ${documentsComplete ? 'complete' : 'incomplete → suspense'})`,
  };
}

const job = {
  name: 'api-claim-preparation',
  // Both document-check outcomes continue here (incomplete → isSuspense=Y), after api-console-upload (and its
  // barcode wait, if a case-page upload went to the console).
  inputStatus: ['API_READY_FOR_CLAIM_PREPARATION'],
  inputs: ['api-claim-intake', 'api-material-download', 'api-claim-recognition', 'api-member-verification', 'api-document-checking'],
  optionalInputs: ['case-override', 'api-console-barcode', 'diagnosis-review'],
  batchLimit: config.iasClaimPreparation.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, barcodeFields, apiFlags };
