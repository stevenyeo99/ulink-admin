const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase } = require('../ias-claim-preparation/service');
const { heldBalanceEnough } = require('../member-verification/memberBalance');
const { Case } = require('../../db/models');
const { barcodeFields } = require('../shared/barcodeFields');
const { openRequests } = require('../case-requests/requests');
const { getSettings } = require('../settings/settings');
const { reviewNeeded } = require('../ias-claim-preparation/preparationReview');

// api-claim-preparation: API case workflow job (docs/imp/day1/api-case-workflow.md section 6.6).
//
//   input:  { 'api-claim-intake': { clNo, tpaCaseNumber }, 'api-material-download': { documents },
//             'api-claim-recognition': { extractedFields, recognizedType },
//             'api-member-verification': { iasMemberInfoResponse },
//             'api-document-checking': { outcome },
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

// A case waiting at API_BALANCE_REVIEW: the balance asked again (one IAS call, no AI) with the heads claim preparation
// chose. No shortage left uncovered (another claim was reversed): back to claim preparation by itself; else it waits.
async function recheckHeldBalance({ caseRecord, input }) {
  const held = input['api-claim-preparation'];
  const enough = await heldBalanceEnough(
    input['api-claim-recognition'].extractedFields,
    input['api-member-verification'].iasMemberInfoResponse,
    input['api-member-verification'].memberVerifyResult,
    held?.claimPrepMeta,
  );
  if (!enough) {
    // Still waiting: to the back of the queue (updatedAt — a wait does not move it), so new cases are never starved.
    await Case.update({ currentStatus: 'API_BALANCE_REVIEW' }, { where: { id: caseRecord.id, currentStatus: 'API_BALANCE_REVIEW' } });
    return { wait: true, output: held };
  }
  return { output: held, nextStatus: 'API_READY_FOR_CLAIM_PREPARATION', message: 'The member balance is enough again: the revision is prepared again.' };
}

async function processCase({ caseRecord, input }) {
  if (caseRecord.currentStatus === 'API_BALANCE_REVIEW') return recheckHeldBalance({ caseRecord, input });
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
    // A suspended claim goes to IAS with the received date as its completion date (user request 2026-10-26);
    // complete documents send today: this job runs only after the console upload and barcode wait finish.
    consoleUploadResult: { completedAt: documentsComplete ? new Date() : caseRecord.createdAt },
    // What a person chose (POST /api/cases/:id/preparation): used as is, on every later preparation too.
    preparationChoice: input['preparation-review'] || null,
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

  // The second balance check found a new shortage (SYSTEM_5 member balance phase D): the case waits at
  // API_BALANCE_REVIEW for a person's bypass, then comes back here.
  if (prepared.hold) {
    return {
      output: { claimPrepMeta: prepared.claimPrepMeta, balanceHold: true },
      nextStatus: 'API_BALANCE_REVIEW',
      message: `Member balance changed before the revision: ${prepared.reason}`,
    };
  }

  // The AI wasn't sure of the diagnosis code, a voucher's benefit or its vitamins / supplements (switches
  // holdUnsureDiagnosis / holdUnsureBenefit / holdUnsureVitamin, owner 2026-10-20): a person decides before anything goes to IAS (preparationReview.js).
  const review = prepared.claimPrepMeta ? reviewNeeded(prepared.claimPrepMeta, await getSettings()) : null;
  if (review) {
    const what = [review.diagnosis && `the diagnosis code (${prepared.diagnosis?.diagCode ?? 'none'})`,
      review.vouchers.length && `the benefit of voucher ${review.vouchers.map((i) => i + 1).join(', ')}`,
      review.rejections.length && `the vitamins / supplements of voucher ${review.rejections.map((i) => i + 1).join(', ')}`].filter(Boolean).join(' and ');
    return {
      output: { ...output, claimPrepMeta: { ...output.claimPrepMeta, review } },
      nextStatus: 'API_PREPARATION_REVIEW',
      message: `Claim ${claim.clNo}: the AI wasn't sure of ${what}; a person decides before the revision`,
    };
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
  // API_BALANCE_REVIEW: re-checked every run, balance only (SYSTEM_5 member balance phase D).
  inputStatus: ['API_READY_FOR_CLAIM_PREPARATION', 'API_BALANCE_REVIEW'],
  inputs: ['api-claim-intake', 'api-material-download', 'api-claim-recognition', 'api-member-verification', 'api-document-checking'],
  // api-claim-preparation: its own last result, for a case waiting at API_BALANCE_REVIEW.
  optionalInputs: ['case-override', 'api-console-barcode', 'preparation-review', 'api-claim-preparation'],
  batchLimit: config.iasClaimPreparation.batchLimit,
  process: processCase,
};

module.exports = { run: (options) => runApiJob(job, options), job, barcodeFields, apiFlags };
