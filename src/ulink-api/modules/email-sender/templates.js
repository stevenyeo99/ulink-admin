/**
 * Renders the body for one EmailTask.taskType. Subject is deliberately left null for
 * both — these are replies within an existing thread, so channels/imapSmtpChannel.js
 * defaults to "Re: <original subject>" itself, matching how a human agent's reply stays
 * on the same subject line rather than introducing a new one.
 *
 * Wording is copied verbatim from docs/samples/20260820/Canned response for Sample.docx
 * (the ULINK-approved canned responses) — not paraphrased, including its own phrasing/
 * quirks, since this is approved customer-facing copy, not our prose to edit.
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

const RENDERERS = {
  MISSING_DOCUMENTS: renderMissingDocuments,
  DOCUMENT_COMPLETE_ACK: renderDocumentCompleteAck,
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
