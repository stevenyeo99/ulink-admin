/**
 * Renders the body for one EmailTask.taskType. Customer-facing renderers leave subject
 * null — these are replies within an existing customer thread, so
 * channels/imapSmtpChannel.js defaults to "Re: <original subject>" itself, matching how a
 * human agent's reply stays on the same subject line rather than introducing a new one.
 * The internal-only renderers (see below) set an explicit subject instead — they land in
 * an ops inbox handling many cases, not a single customer thread, so a scannable
 * case-id-based subject is more useful than "Re: <that case's original subject>".
 *
 * MISSING_DOCUMENTS's wording is copied verbatim from docs/samples/20260820/Canned
 * response for Sample.docx (the ULINK-approved canned responses) where a line has one —
 * not paraphrased, including its own phrasing/quirks. Two of the issue lines it can carry
 * (see modules/document-checking/checklist.js's ISSUES) are NOT from that approved doc —
 * placeholder wording, flag for business sign-off before relying on the exact phrasing.
 * SUBMISSION_NOT_RECOGNIZED is the same story — no approved canned line exists yet for an
 * unrecognized submission; composed wording, needs sign-off before real customers see it.
 *
 * MEMBER_VERIFY_ISSUE, CLAIM_APPROVAL_REVIEW, and CLAIM_SUBMIT_ISSUE are INTERNAL-ONLY (see
 * email-sender/service.js's INTERNAL_ONLY_TASK_TYPES) — none of these three map to "email
 * the customer directly" per SOP: member-verification/claim-submission findings are "hold
 * and verify/escalate" (§11), and claim approval itself happens outside JD1 entirely (§14)
 * — this system can't even detect when it happens, so CLAIM_APPROVAL_REVIEW is the "ready
 * for JD2 handover" signal (§13), not a customer notice. Unlike every other renderer here,
 * their content is written for an ops reader and can freely include raw diagnostic detail
 * (extracted-vs-IAS values, the real IAS rejection reason) — exactly what every *other*
 * template in this file deliberately keeps away from customers.
 */

const MISSING_DOCUMENTS_INTRO = `Dear Valued Customer,

Please be informed that in order to process the claim that have submitted, the following information needs to be completed:
`;

const MISSING_DOCUMENTS_FOOTER = `
Please re-submit the required document(s) in order to start the claims process. Should you have any questions, kindly contact us at ayahealthinfo@ayasompo.com or call our hotline during office hours.
Please be note that claim might be rejected in event that they do not meet the requirements regardless of requesting for the additional documents.
Please note that if all the necessary documents supporting your claim have been satisfactorily submitted, we will notify you of the claim outcomes in 2-7 business days for small claims and 7-10 business days for large claims on average.
Thank you & Best Regards,`;

const DOCUMENT_COMPLETE_ACK_BODY = `Dear Valued Customer,

We thank you and acknowledge your claim submission.

We will inform you if additional information is required.

Please note that if all the necessary documents supporting your claim have been satisfactorily submitted, we will notify you of the claim outcomes in 2-7 business days for small claims and 7-10 business days for large claims on average.

If you have any questions, kindly contact us at ayahealthinfo@ayasompo.com.

Thank you and Best Regards,`;

function renderMissingDocuments(payload) {
  const issues = payload.issues || [];
  const bullets = issues.map((issue) => `- ${issue}`).join('\n');
  return { subject: null, bodyText: `${MISSING_DOCUMENTS_INTRO}${bullets}\n${MISSING_DOCUMENTS_FOOTER}` };
}

/**
 * Internal-ops notice (see this file's header comment) — SOP §11 action lines quoted
 * directly so the reader knows what's actually expected, not just that something failed.
 * Own explicit subject rather than the usual "Re: <customer subject>" default: this lands
 * in an ops inbox handling many cases, not a single customer thread, so a scannable
 * case-id + reasonCode subject is more useful than the original email's subject line.
 */
const REASON_CODE_TO_SOP_ACTION = {
  MEMBER_NOT_FOUND: 'Hold the case and verify against IAS/member census or escalate.',
  COVERAGE_NOT_ACTIVE: 'Flag for eligibility assessment/escalation.',
  MEMBER_DETAILS_MISMATCH: 'Hold the case and verify against IAS/member census or escalate.',
  BANK_DETAILS_MISMATCH: 'Hold payment-related verification and clarify required bank information.',
};

function renderMemberVerifyIssue(payload) {
  const { caseId, reasonCode, reason } = payload;
  const sopAction = REASON_CODE_TO_SOP_ACTION[reasonCode] || 'Hold and review.';

  return {
    subject: `Member verification hold — Case ${caseId} — ${reasonCode}`,
    bodyText: `Member-verification could not confirm this case against IAS. Do NOT reply to the customer until this is resolved (SOP §11: member/policy and bank findings are held for internal verification, not sent to the customer).

Case ID: ${caseId}
Reason code: ${reasonCode}
Detail: ${reason}

SOP-required action: ${sopAction}`,
  };
}

function renderDocumentCompleteAck() {
  return { subject: null, bodyText: DOCUMENT_COMPLETE_ACK_BODY };
}

// Internal-only (see this file's header comment) — the real IAS rejection reason is
// exactly what ops needs to act on, unlike the old customer-facing wording this replaced
// (which deliberately hid it).
function renderClaimSubmitIssue(payload) {
  const { caseId, errorMessage } = payload;
  return {
    subject: `Claim submission failed — Case ${caseId}`,
    bodyText: `IAS rejected this claim submission. Case sits at CLAIM_SUBMIT_FAILED and is NOT retried automatically — needs manual follow-up.

Case ID: ${caseId}
IAS rejection reason: ${errorMessage}`,
  };
}

const SUBMISSION_NOT_RECOGNIZED_BODY = `Dear Valued Customer,

Thank you for reaching out. We were unable to recognize this submission as a claim we can process automatically.

Kindly contact our customer service team directly at ayahealthinfo@ayasompo.com or call our hotline during office hours so we can assist you further.

Thank you and Best Regards,`;

// Deliberately generic — this fires when the submission didn't match any known claim
// route at all (Case.currentStatus=NOT_RECOGNIZED), so there's no specific issue list to
// give, unlike MISSING_DOCUMENTS/MEMBER_VERIFY_ISSUE.
function renderSubmissionNotRecognized() {
  return { subject: null, bodyText: SUBMISSION_NOT_RECOGNIZED_BODY };
}

// Internal-only (see this file's header comment) — replaces the old customer-facing
// CLAIM_CREATED_NOTIFICATION. This is the SOP §13 "ready for JD2 handover" signal: JD1's
// automated work is done, a human now needs to review/approve before the customer is ever
// told a claim number (which happens outside this system, manually, once approved).
function renderClaimApprovalReview(payload) {
  const { caseId, claimNo } = payload;
  return {
    subject: `Claim ready for JD2 approval — Case ${caseId} — Claim ${claimNo}`,
    bodyText: `A claim has been created in IAS and is ready for JD2 review/approval. JD1's automated checks are complete for this case.

Case ID: ${caseId}
Claim Number: ${claimNo}

Note: the customer has NOT been told their claim number yet — that happens manually once JD2 has reviewed/approved.`,
  };
}

const RENDERERS = {
  MISSING_DOCUMENTS: renderMissingDocuments,
  DOCUMENT_COMPLETE_ACK: renderDocumentCompleteAck,
  MEMBER_VERIFY_ISSUE: renderMemberVerifyIssue,
  CLAIM_SUBMIT_ISSUE: renderClaimSubmitIssue,
  SUBMISSION_NOT_RECOGNIZED: renderSubmissionNotRecognized,
  CLAIM_APPROVAL_REVIEW: renderClaimApprovalReview,
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
