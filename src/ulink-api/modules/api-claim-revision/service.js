const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { reviseClaim } = require('./iasClient');

// api-claim-revision: API case workflow job (docs/imp/day1/api-case-workflow.md section 6.7).
//
//   input:  { 'api-claim-preparation': { payload, documentsComplete, isStp } }
//   output: { response, isSuspense, isStp, email }
//
// Sends the prepared revision body to IAS (POST /api/claim_revision). Always a revision, never a
// new claim: the claim already exists in IAS. IAS answers like claim submission, and the outcome is
// handled the same way as the email flow's ias-claim-creation:
// - success, documents complete      → API_CLAIM_REVISED (non-STP: internal CLAIM_APPROVAL_REVIEW email)
// - success, documents incomplete    → API_CLAIM_SUSPENDED — suspense set in IAS, the customer was
//                                      asked for documents; their reply restarts the case, and the next
//                                      revision (isSuspense=N) lifts the suspense
// - success: false                   → API_CLAIM_REVISION_FAILED, not retried (internal CLAIM_SUBMIT_ISSUE email)
// - network error / timeout / non-2xx → thrown: FAILED step, retried next run
// Revising the same claimNo again is safe (confirmed 2026-09-24).

async function processCase({ caseRecord, input }) {
  const prepared = input['api-claim-preparation'];
  const { payload } = prepared;
  const response = await reviseClaim(payload);
  const claimNo = payload.claimNo;

  if (response?.success !== true) {
    const errorMessage = response?.error || 'IAS rejected the claim revision';
    return {
      output: {
        response,
        isSuspense: payload.isSuspense,
        isStp: prepared.isStp,
        email: { taskType: 'CLAIM_SUBMIT_ISSUE', audience: 'internal', payload: { caseId: caseRecord.id, errorMessage }, dedupeKey: errorMessage },
      },
      nextStatus: 'API_CLAIM_REVISION_FAILED',
      message: `IAS rejected the revision of claim ${claimNo}: ${errorMessage}`,
    };
  }

  const suspended = payload.isSuspense === 'Y';
  return {
    output: {
      response,
      isSuspense: payload.isSuspense,
      isStp: prepared.isStp,
      // Same as the email flow: a non-STP claim that's through is handed to JD2 for approval.
      email: !suspended && !prepared.isStp
        ? { taskType: 'CLAIM_APPROVAL_REVIEW', audience: 'internal', payload: { caseId: caseRecord.id, claimNo }, dedupeKey: null }
        : null,
    },
    nextStatus: suspended ? 'API_CLAIM_SUSPENDED' : 'API_CLAIM_REVISED',
    message: suspended
      ? `Claim ${claimNo} revised with suspense (documents missing); waiting for the customer`
      : `Claim ${claimNo} revised${prepared.isStp ? ' (STP)' : ''}`,
  };
}

const job = {
  name: 'api-claim-revision',
  inputStatus: 'API_CLAIM_PAYLOAD_PREPARED',
  inputs: ['api-claim-preparation'],
  // One real IAS write per case — same modest batch as claim creation.
  batchLimit: config.iasClaimCreation.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
