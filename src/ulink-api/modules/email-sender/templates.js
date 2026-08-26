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
 * CLAIM_CREATED_NOTIFICATION, MEMBER_VERIFY_ISSUE, and CLAIM_SUBMIT_ISSUE are the same
 * story — no approved canned line exists yet for "your claim number is X", a
 * member-verification mismatch, or a claim submission rejection; composed wording, needs
 * sign-off before real customers see it.
 *
 * MEMBER_VERIFY_ISSUE is member-verification's own template (its four reasonCodes used to
 * reuse MISSING_DOCUMENTS — same ISSUES.* lines, but framed as "please resubmit documents",
 * which is wrong for a details-mismatch/not-found outcome where nothing is actually
 * missing). Same issue-line source of truth (document-checking/checklist.js's ISSUES), only
 * the surrounding intro/footer differs.
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

const MEMBER_VERIFY_ISSUE_INTRO = `Dear Valued Customer,

Thank you for your claim submission. We were unable to verify the following against our records:
`;

const MEMBER_VERIFY_ISSUE_FOOTER = `
Please reply to this email with the corrected information so we can proceed with your claim. Should you have any questions, kindly contact us at ayahealthinfo@ayasompo.com or call our hotline during office hours.
Thank you & Best Regards,`;

function renderMemberVerifyIssue(payload) {
  const issues = payload.issues || [];
  const bullets = issues.map((issue) => `- ${issue}`).join('\n');
  return { subject: null, bodyText: `${MEMBER_VERIFY_ISSUE_INTRO}${bullets}\n${MEMBER_VERIFY_ISSUE_FOOTER}` };
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
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
