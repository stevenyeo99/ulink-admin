const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { ApiCaseStep } = require('../../db/models');
const { checkCase } = require('../member-verification/service');
const { withChosenPicks } = require('../member-verification/memberBalance');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { caseBasics } = require('../assessment-summary/journey');

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
  // A person chooses an unsure benefit head (SYSTEM_5 member balance phase C). Not re-checked every run: it waits.
  BENEFIT_REVIEW: 'API_BENEFIT_REVIEW',
};

async function processCase({ caseRecord, input }) {
  const { extractedFields, recognizedType } = input['api-claim-recognition'];
  // The last member check's result (a waiting run keeps its output too): its head picks are reused (SYSTEM_5 member balance).
  const last = await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'api-member-verification', status: ['DONE', 'WAITING'] }, order: [['createdAt', 'DESC']] });
  // A person's head choices (the 'benefit-review' step, POST /api/cases/:id/benefit) go over the last picks.
  const chosen = await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'benefit-review', status: 'DONE' }, order: [['createdAt', 'DESC']] });
  const fresh = chosen && (!last || chosen.createdAt > last.createdAt); // later runs find the choice in the last picks
  const memberVerifyResult = withChosenPicks(last?.output?.memberVerifyResult, fresh ? chosen.output.picks : null);
  const { outcome, result, iasResponse } = await checkCase({ id: caseRecord.id, extractedFields, recognizedType, memberVerifyResult });
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
        payload: {
          caseId: caseRecord.id,
          claimNo: caseRecord.claimNo,
          reasonCode: result.reasonCode,
          reason: result.reason,
          issues: result.issues,
          assessment: assessmentSummaryText(buildAssessmentSummary({
            ...caseBasics(caseRecord), recognizedType, currentStatus: nextStatus, memberVerifyResult: result,
          })),
        },
        dedupeKey: result.reasonCode,
      }
      : null,
  };

  // A re-check that still finds a problem changes nothing: the case keeps waiting.
  if (caseRecord.currentStatus === nextStatus && ['API_MEMBER_REVIEW_REQUIRED', 'API_BENEFIT_REVIEW'].includes(nextStatus)) {
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
  // API_BENEFIT_REVIEW: re-checked every run like member review — still waiting while the switch is on, on its way once
  // it is off (SYSTEM_5 member balance phase C).
  inputStatus: ['API_RECOGNIZED', 'API_MEMBER_REVIEW_REQUIRED', 'API_BENEFIT_REVIEW'],
  inputs: ['api-claim-recognition'],
  batchLimit: config.memberVerification.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
