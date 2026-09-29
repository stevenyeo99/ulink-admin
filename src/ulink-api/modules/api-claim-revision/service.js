const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { reviseClaim } = require('./iasClient');
const { assessmentFor } = require('../api-pipeline/assessment');

// api-claim-revision: API case workflow job (docs/imp/day1/api-case-workflow.md section 6.7).
//
//   input:  { 'api-claim-preparation': { payload, documentsComplete, isStp, claimPrepMeta },
//             'api-member-verification', 'api-document-checking' }   (their results go into the JD2 email's assessment)
//   output: { response, isSuspense, isStp, email }
//
// Sends the prepared revision body to IAS (POST /api/claim_revision). Always a revision, never a
// new claim: the claim already exists in IAS. IAS answers like claim submission, and the outcome is
// handled the same way as the email flow's ias-claim-creation:
// - success, documents complete, STP → API_AWAITING_CSR (api-claim-stp fetches the settlement report)
// - success, documents complete, non-STP → API_CLAIM_REVISED (internal CLAIM_APPROVAL_REVIEW email; JD2)
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
        email: {
          taskType: 'CLAIM_SUBMIT_ISSUE',
          audience: 'internal',
          payload: { caseId: caseRecord.id, errorMessage, assessment: assessmentFor(input, caseRecord, { currentStatus: 'API_CLAIM_REVISION_FAILED', iasClaimResult: { error: errorMessage } }) },
          dedupeKey: errorMessage,
        },
      },
      nextStatus: 'API_CLAIM_REVISION_FAILED',
      message: `IAS rejected the revision of claim ${claimNo}: ${errorMessage}`,
    };
  }

  const suspended = payload.isSuspense === 'Y';
  const stpThrough = !suspended && prepared.isStp;
  const nextStatus = suspended ? 'API_CLAIM_SUSPENDED' : (prepared.isStp ? 'API_AWAITING_CSR' : 'API_CLAIM_REVISED');
  const assessment = assessmentFor(input, caseRecord, { currentStatus: nextStatus, iasClaimResult: response });
  // Missing documents: the customer was already asked (api-document-checking); the team is told too,
  // with why the case went this way (17/09 meeting notes, item 4) — same email as the email flow's.
  const missing = input['api-document-checking']?.documentCheckResult?.issues || [];
  return {
    output: {
      response,
      isSuspense: payload.isSuspense,
      isStp: prepared.isStp,
      // An STP claim gets no JD2 email, so its AI assessment is kept here as the audit snapshot.
      assessment: stpThrough ? assessment : null,
      // Same as the email flow: a non-STP claim that's through is handed to JD2 for approval, with the
      // AI assessment (17/09 meeting, action 10) — kept in this output as the case's audit snapshot.
      email: suspended
        ? { taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { caseId: caseRecord.id, claimNo, issues: missing, assessment }, dedupeKey: [...missing].sort().join('|') }
        : !prepared.isStp
          ? { taskType: 'CLAIM_APPROVAL_REVIEW', audience: 'internal', payload: { caseId: caseRecord.id, claimNo, assessment }, dedupeKey: null }
          : null,
    },
    nextStatus,
    message: suspended
      ? `Claim ${claimNo} revised with suspense (documents missing); waiting for the customer`
      : `Claim ${claimNo} revised${prepared.isStp ? ' (STP)' : ''}`,
  };
}

const job = {
  name: 'api-claim-revision',
  inputStatus: 'API_CLAIM_PAYLOAD_PREPARED',
  inputs: ['api-claim-preparation'],
  optionalInputs: ['api-claim-recognition', 'api-member-verification', 'api-document-checking', 'case-override'],
  // One real IAS write per case — same modest batch as claim creation.
  batchLimit: config.iasClaimCreation.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
