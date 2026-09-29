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
 * CSR_REPORT is the same story as SUBMISSION_NOT_RECOGNIZED — no approved canned line
 * exists yet for handing over a settlement report; composed wording, needs sign-off before
 * real customers see it. Unlike every other renderer here, it carries an attachment (the
 * downloaded CSR PDF, path-based — nodemailer reads the file itself, see
 * modules/ias-claim-stp/service.js for where that file gets written).
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

const path = require('path');
const config = require('../../config');

// Shared sign-off for every customer-facing template below — these are automated replies,
// not a human agent's, so the signer is the bot, not a person's name.
const SIGN_OFF = `Thank you & Best Regards,
ULINK AI Bot`;

// Shared subject prefix for the three internal-only renderers below (never the
// customer-facing ones, which set subject: null so imapSmtpChannel.js's own
// "Re: <original subject>" default applies instead) — so ops can tell at a glance, before
// opening it, that a message in their inbox came from this system rather than a colleague.
const INTERNAL_SUBJECT_PREFIX = '(ULINK AI) ';

// Internal emails end with the AI assessment (what the system decided and why — 17/09 meeting,
// actions #7 / #10) and a link to the case in the console. Both optional: a task queued before
// either existed, or no CONSOLE_URL configured, reads as it always did.
function internalExtras({ caseId, assessment }) {
  const link = config.consoleUrl && caseId ? `\n\nOpen this case: ${config.consoleUrl}/cases/${caseId}` : '';
  const ai = assessment ? `\n\nAI assessment — what the system decided and why:\n\n${assessment}` : '';
  return `${link}${ai}`;
}

const MISSING_DOCUMENTS_INTRO = `Dear Valued Customer,

Please be informed that in order to process the claim that have submitted, the following information needs to be completed:

`;

const MISSING_DOCUMENTS_FOOTER = `
Please re-submit the required document(s) in order to start the claims process. Should you have any questions, kindly contact us at ayahealthinfo@ayasompo.com or call our hotline during office hours.

Please be note that claim might be rejected in event that they do not meet the requirements regardless of requesting for the additional documents.

Please note that if all the necessary documents supporting your claim have been satisfactorily submitted, we will notify you of the claim outcomes in 2-7 business days for small claims and 7-10 business days for large claims on average.

${SIGN_OFF}`;

const DOCUMENT_COMPLETE_ACK_BODY = `Dear Valued Customer,

We thank you and acknowledge your claim submission.

We will inform you if additional information is required.

Please note that if all the necessary documents supporting your claim have been satisfactorily submitted, we will notify you of the claim outcomes in 2-7 business days for small claims and 7-10 business days for large claims on average.

If you have any questions, kindly contact us at ayahealthinfo@ayasompo.com.

${SIGN_OFF}`;

function renderMissingDocuments(payload) {
  const issues = payload.issues || [];
  // Numbered, one item per outstanding issue (17/09 meeting, action 4). An issue's own
  // "Reason:" line is re-indented to sit under its number.
  const bullets = issues
    .map((issue) => String(issue).trim())
    .filter(Boolean)
    .map((issue, i) => `${i + 1}. ${issue.replace(/\n\s*/g, '\n   ')}`)
    .join('\n');
  const intro = MISSING_DOCUMENTS_INTRO.trimEnd();
  const footer = MISSING_DOCUMENTS_FOOTER.trim();
  return { subject: null, bodyText: `${intro}\n${bullets}\n\n${footer}` };
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
  // Every problem found (issues, A2 2026-09-29); tasks queued before that carry reasonCode only.
  const codes = [...new Set((payload.issues || []).map((issue) => issue.reasonCode))];
  if (codes.length === 0) codes.push(reasonCode);
  const actions = [...new Set(codes.map((code) => REASON_CODE_TO_SOP_ACTION[code] || 'Hold and review.'))];
  const requiredAction = actions.join(' ');
  const more = codes.length > 1 ? ` (+${codes.length - 1} more)` : '';

  // Case ID is deliberately kept in the subject only, not repeated in the body — the
  // subject is what a reviewer scans in an ops inbox handling many cases; the body reads
  // as a friendly heads-up rather than a data dump (2026-09-16, at user's request).
  return {
    subject: `${INTERNAL_SUBJECT_PREFIX}Member verification hold — Case ${caseId} — ${reasonCode}${more}`,
    bodyText: `Hi team,

We weren't able to confirm this case's member/bank details against IAS yet, so please hold off replying to the customer until it's sorted out — member and bank findings need internal verification first.

Reason code: ${codes.join(', ')}
Detail: ${reason}

Required action: ${requiredAction}${internalExtras(payload)}

${SIGN_OFF}`,
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
    subject: `${INTERNAL_SUBJECT_PREFIX}Claim submission failed — Case ${caseId}`,
    bodyText: `IAS rejected this claim submission. Case sits at CLAIM_SUBMIT_FAILED and is NOT retried automatically — needs manual follow-up.

Case ID: ${caseId}
IAS rejection reason: ${errorMessage}${internalExtras(payload)}`,
  };
}

const SUBMISSION_NOT_RECOGNIZED_BODY = `Dear Valued Customer,

Thank you for reaching out. We were unable to recognize this submission as a claim we can process automatically.

Kindly contact our customer service team directly at ayahealthinfo@ayasompo.com or call our hotline during office hours so we can assist you further.

${SIGN_OFF}`;

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
  const { claimNo } = payload;
  return {
    subject: `${INTERNAL_SUBJECT_PREFIX}Claim ready for review — Claim ${claimNo}`,
    bodyText: `A claim has been created in IAS and is ready for review and approval. The automated document and claim checks are complete.

Claim Number: ${claimNo}

Please review and approve the claim before communicating the claim number to the customer.${internalExtras(payload)}

${SIGN_OFF}`,
  };
}

// Composed wording, no approved canned line exists for this yet — see this file's header
// comment. Customer-facing, carries the downloaded CSR as a path-based attachment.
function renderCsrReport(payload) {
  const { csrFilePath, claimNo } = payload;
  return {
    subject: null,
    bodyText: `Dear Valued Customer,

Your claim (Claim Number: ${claimNo}) has been processed and the Claim Settlement Report is attached for your reference.

If you have any questions, kindly contact us at ayahealthinfo@ayasompo.com or call our hotline during office hours.

${SIGN_OFF}`,
    attachments: [{ filename: path.basename(csrFilePath), path: csrFilePath }],
  };
}

// Internal copy of a missing-documents request (17/09 meeting notes, item 4): the customer was already
// asked; nothing to do unless they don't reply. claimNo only on API cases (email cases have none yet).
// held (switch "hold the missing-documents email when the AI is unsure"): the AI's unsure points — the
// customer has NOT been emailed; a person decides: send the request, or override the check.
function renderDocumentsIncomplete(payload) {
  const { caseId, claimNo, issues = [], held } = payload;
  const ref = claimNo ? `Claim ${claimNo}` : `Case ${caseId}`;
  const list = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
  const intro = held?.length
    ? `ACTION NEEDED — the customer has NOT been emailed yet. The AI was unsure about: ${held.join('; ')}.
Open the case and check the documents, then either send the customer the request below, or override the document check if the documents are fine.`
    : "The customer has been asked for the missing documents below. No action is needed unless they don't reply.";
  return {
    subject: `${INTERNAL_SUBJECT_PREFIX}${held?.length ? 'Check before emailing the customer' : 'Documents incomplete'} — ${ref} — ${issues.length} missing`,
    bodyText: `Hi team,

${intro}

Missing:
${list}${internalExtras(payload)}

${SIGN_OFF}`,
  };
}

// Internal: a cl-upload case needs a person (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md).
// problem: what went wrong in a few words; detail: the specifics (case number read, API answer, wait time).
function renderConsoleUploadIssue(payload) {
  const { caseId, problem, detail } = payload;
  return {
    subject: `${INTERNAL_SUBJECT_PREFIX}Console upload — ${problem} — Case ${caseId}`,
    bodyText: `Hi team,

This case can't go on to the IAS claim until the console upload is sorted out.

Problem: ${problem}
Detail: ${detail}${internalExtras(payload)}

${SIGN_OFF}`,
  };
}

const RENDERERS = {
  MISSING_DOCUMENTS: renderMissingDocuments,
  DOCUMENT_COMPLETE_ACK: renderDocumentCompleteAck,
  MEMBER_VERIFY_ISSUE: renderMemberVerifyIssue,
  CLAIM_SUBMIT_ISSUE: renderClaimSubmitIssue,
  SUBMISSION_NOT_RECOGNIZED: renderSubmissionNotRecognized,
  CLAIM_APPROVAL_REVIEW: renderClaimApprovalReview,
  CSR_REPORT: renderCsrReport,
  DOCUMENTS_INCOMPLETE: renderDocumentsIncomplete,
  CONSOLE_UPLOAD_ISSUE: renderConsoleUploadIssue,
};

function render(taskType, payload) {
  const renderer = RENDERERS[taskType];
  if (!renderer) throw new Error(`No email template for taskType "${taskType}"`);
  return renderer(payload || {});
}

module.exports = { render };
