/**
 * Renders the body for one EmailTask.taskType. Subject is deliberately left null for
 * both — these are replies within an existing thread, so channels/imapSmtpChannel.js
 * defaults to "Re: <original subject>" itself, matching how a human agent's reply stays
 * on the same subject line rather than introducing a new one.
 *
 * MISSING_DOCUMENTS's wording is copied verbatim from docs/samples/20260820/Canned
 * response for Sample.docx (the ULINK-approved canned responses) where a line has one —
 * not paraphrased, including its own phrasing/quirks. Two of the issue lines it can carry
 * (see modules/member-verification/service.js's REASON_CODE_TO_ISSUE) are NOT from that
 * approved doc — MEMBER_NOT_VERIFIED and POLICY_NOT_ACTIVE_ON_TREATMENT_DATE, defined in
 * modules/document-checking/checklist.js, are placeholder wording composed for this feature
 * (no approved canned line exists for "member not found"/"coverage inactive" yet) — flag
 * for business sign-off before relying on the exact phrasing. CLAIM_CREATED_NOTIFICATION is
 * the same story — no approved canned line exists for "your claim number is X" either;
 * composed wording, needs sign-off before real customers see it.
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

function renderDocumentCompleteAck() {
  return { subject: null, bodyText: DOCUMENT_COMPLETE_ACK_BODY };
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
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
