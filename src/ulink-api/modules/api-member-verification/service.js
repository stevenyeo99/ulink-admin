const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase } = require('../member-verification/service');

// api-member-verification: API case workflow job 4 (docs/imp/day1/api-case-workflow.md section 6.5).
//
//   input:  { 'api-claim-recognition': { recognizedType, extractedFields, ... } }
//   output: { outcome, memberVerifyResult, iasMemberInfoResponse, email }
//
// The email flow's own member check, unchanged: member-verification's checkCase does the IAS
// member lookup and every rule (hard/soft field checks, exclusions, benefit eligibility and
// limits); it only reads id / extractedFields / recognizedType, which come from the OCR output.
// Like the email flow, a case waiting on a member issue is re-checked every run, so a fix made
// in IAS by the internal team moves it on by itself (S14).

const OUTCOME_TO_STATUS = {
  MEMBER_VERIFIED: 'API_READY_FOR_DOCUMENT_CHECKING',
  MEMBER_REVIEW_REQUIRED: 'API_MEMBER_REVIEW_REQUIRED',
};

async function processCase({ caseRecord, input }) {
  const { extractedFields, recognizedType } = input['api-claim-recognition'];
  const { outcome, result, iasResponse } = await checkCase({ id: caseRecord.id, extractedFields, recognizedType });
  const nextStatus = OUTCOME_TO_STATUS[outcome];
  if (!nextStatus) throw new Error(`Unexpected member check outcome: ${outcome}`);

  const output = {
    outcome,
    memberVerifyResult: result,
    iasMemberInfoResponse: iasResponse,
    // The email the email flow sends for this outcome, same payload and dedupe key
    // (member-verification's queueReviewRequiredEmail). Sent by api-email-sender.
    email: nextStatus === 'API_MEMBER_REVIEW_REQUIRED'
      ? {
        taskType: 'MEMBER_VERIFY_ISSUE',
        audience: 'internal',
        payload: { caseId: caseRecord.id, reasonCode: result.reasonCode, reason: result.reason },
        dedupeKey: result.reasonCode,
      }
      : null,
  };

  // A re-check that still finds a problem changes nothing: the case keeps waiting.
  if (caseRecord.currentStatus === 'API_MEMBER_REVIEW_REQUIRED' && nextStatus === 'API_MEMBER_REVIEW_REQUIRED') {
    return { wait: true, output };
  }
  return {
    output,
    nextStatus,
    message: result.reasonCode ? `Member check: ${result.reasonCode}` : 'Member and coverage verified',
  };
}

const job = {
  name: 'api-member-verification',
  inputStatus: ['API_RECOGNIZED', 'API_MEMBER_REVIEW_REQUIRED'],
  inputs: ['api-claim-recognition'],
  batchLimit: config.memberVerification.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
