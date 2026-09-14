/**
 * Renders the body for one EmailTask.taskType. Subject is deliberately left null for
 * both — these are replies within an existing thread, so channels/imapSmtpChannel.js
 * defaults to "Re: <original subject>" itself, matching how a human agent's reply stays
 * on the same subject line rather than introducing a new one.
 *
 * MISSING_DOCUMENTS's wording is copied verbatim from docs/samples/20260820/Canned
 * response for Sample.docx (the ULINK-approved canned responses) where a line has one —
 * not paraphrased, including its own phrasing/quirks. Two of the issue lines it can carry
 * (see modules/document-checking/checklist.js's ISSUES) are NOT from that approved doc —
 * placeholder wording, flag for business sign-off before relying on the exact phrasing.
 * CLAIM_CREATED_NOTIFICATION, CLAIM_SUBMIT_ISSUE, and SUBMISSION_NOT_RECOGNIZED are the
 * same story — no approved canned line exists yet for "your claim number is X", a claim
 * submission rejection, or an unrecognized submission; composed wording, needs sign-off
 * before real customers see it.
 *
 * MEMBER_VERIFY_ISSUE is INTERNAL-ONLY (see email-sender/service.js's
 * INTERNAL_ONLY_TASK_TYPES) — SOP §11 frames member-verification's findings ("Member/policy
 * mismatch", "Bank detail issue") as "hold and verify/escalate", never a direct customer
 * request, unlike MISSING_DOCUMENTS. So unlike every other renderer in this file, its
 * content is written for an ops reader, not a customer, and can freely include raw
 * extracted-vs-IAS diagnostic detail — the thing every *other* template here deliberately
 * keeps away from customers (see renderClaimSubmitIssue's comment).
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

const CLAIM_SUBMIT_ISSUE_BODY = `Dear Valued Customer,

We encountered an issue while submitting your claim and are unable to proceed automatically at this time. Our team will review your case and follow up with you directly.

If you have any questions, kindly contact us at ayahealthinfo@ayasompo.com or call our hotline during office hours.

Thank you and Best Regards,`;

// Deliberately generic — no raw IAS error text (e.g. "Claim already exists") to the
// customer; that detail stays internal (Case.iasClaimResult / CaseEvent.message, per
// ias-claim-creation/service.js) for admin follow-up, same as every other outcome here never
// exposing raw system detail to a customer.
function renderClaimSubmitIssue() {
  return { subject: null, bodyText: CLAIM_SUBMIT_ISSUE_BODY };
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

function renderClaimCreatedNotification(payload) {
  const claimNo = payload.claimNo || 'N/A';
  return {
    subject: null,
    bodyText: `Dear Valued Customer,

We are pleased to inform you that your claim has been successfully created in our system.

Your Claim Number: ${claimNo}

We will notify you of the outcome in due course. If you have any questions, kindly contact us at ayahealthinfo@ayasompo.com.

Thank you and Best Regards,`,
  };
}

const RENDERERS = {
  MISSING_DOCUMENTS: renderMissingDocuments,
  DOCUMENT_COMPLETE_ACK: renderDocumentCompleteAck,
  CLAIM_CREATED_NOTIFICATION: renderClaimCreatedNotification,
  MEMBER_VERIFY_ISSUE: renderMemberVerifyIssue,
  CLAIM_SUBMIT_ISSUE: renderClaimSubmitIssue,
  SUBMISSION_NOT_RECOGNIZED: renderSubmissionNotRecognized,
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
