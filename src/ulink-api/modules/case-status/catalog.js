// Case status catalog — the one place that says what each Case.currentStatus code means to a person
// (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, section 5).
//
// Codes stay the system's internal language (jobs, DB, logs). Anything shown to users — the
// console's status badge, filters, dashboard counts — reads the label / description / module /
// group from here instead. A job that adds a status adds one line here; tests/caseStatusCatalog.test.js
// fails if a status used in the code is missing.

// Where the case is in the claim flow — one dashboard page per module.
const MODULES = [
  { id: 'intake', label: 'Intake' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'member', label: 'Member verification' },
  { id: 'documents', label: 'Document checking' },
  { id: 'claim', label: 'Claim & IAS' },
  { id: 'stp', label: 'STP & settlement report' },
];

// Who has to act next — the status badge colour and the list filters.
const GROUPS = [
  { id: 'in_progress', label: 'In progress' },         // the system will move it on by itself
  { id: 'waiting_customer', label: 'Waiting on customer' },
  { id: 'needs_review', label: 'Needs review' },       // a person has to look
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
];

const status = (module, group, label, description) => ({ module, group, label, description });

const CASE_STATUSES = {
  // Email cases (docs/imp/day1/jobs-registry.md)
  EMAIL_RECEIVED: status('intake', 'in_progress', 'Email received', 'A new email arrived; its attachments are being stored.'),
  ATTACHMENTS_STORED: status('intake', 'in_progress', 'Attachments stored', 'Attachments are saved and waiting to be read.'),
  READY_FOR_DOCUMENT_READING: status('recognition', 'in_progress', 'Waiting to be read', 'Documents are queued for AI reading.'),
  RECOGNIZED: status('recognition', 'in_progress', 'Read by AI', 'Documents were read; the member check runs next.'),
  NOT_RECOGNIZED: status('recognition', 'failed', 'Not a claim we handle', "The email didn't match any claim type; the sender was asked to contact customer service."),
  MANUAL_REVIEW: status('recognition', 'needs_review', 'Needs manual reading', "The AI couldn't read the documents reliably; a person should check them."),
  MEMBER_REVIEW_REQUIRED: status('member', 'needs_review', 'Member check issue', "Member, coverage or bank details don't match IAS; held for internal review."),
  READY_FOR_DOCUMENT_CHECKING: status('documents', 'in_progress', 'Checking documents', 'The member check passed; the document checklist runs next.'),
  INCOMPLETE: status('documents', 'waiting_customer', 'Documents incomplete', "Documents are missing or unclear; the customer was emailed the list and the case waits for their reply."),
  // Switch "hold the missing-documents email when the AI is unsure" on: a person checks before the customer is emailed.
  DOCUMENTS_REVIEW: status('documents', 'needs_review', 'Check before emailing customer', "Documents look incomplete, but the AI wasn't sure. The customer has NOT been emailed: check the documents, then send the request or override the check."),
  // Switch "documents the AI passed but wasn't sure about: a person confirms first" on (SYSTEM_4 E4-09).
  DOCUMENTS_UNSURE: status('documents', 'needs_review', "Check the AI's documents finding", "All documents passed, but the AI wasn't sure about some of them, or a person asked for something the AI can't check (see the review points). Check them against the documents, then confirm to continue — or request more information; nothing has been prepared for IAS yet."),
  MEMBER_VERIFIED: status('documents', 'in_progress', 'Checks passed', 'Member and documents are checked; documents go to the console next.'),
  // Console upload by API (cl-upload): the console creates the barcode later, about every 15 minutes
  // (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md).
  CONSOLE_BARCODE_PENDING: status('claim', 'in_progress', 'Waiting for console barcode', 'Documents were uploaded to the console; the console creates the barcode about every 15 minutes. The system checks again on every run.'),
  CONSOLE_BARCODE_MISSING: status('claim', 'needs_review', 'Console barcode not received', 'Documents were uploaded to the console, but no barcode came back within the expected time. The system keeps checking; check the console side.'),
  CASE_NUMBER_UNCLEAR: status('claim', 'needs_review', 'Case number unclear', "The case number read from the claim form doesn't look like AYA-CL- and 8 digits, so the documents were not uploaded to the console."),
  CONSOLE_UPLOAD_FAILED: status('claim', 'needs_review', 'Console upload refused', 'The console upload API refused the documents; the reason is in the case history.'),
  DOCUMENTS_UPLOADED: status('claim', 'in_progress', 'Documents uploaded', 'Documents are in the console; the IAS claim is being prepared.'),
  CLAIM_PAYLOAD_PREPARED: status('claim', 'in_progress', 'Claim prepared', 'The IAS claim is built and about to be submitted.'),
  CLAIM_CREATED: status('claim', 'done', 'Created in IAS', 'The claim is in IAS. Non-STP: waiting for JD3 approval. STP: the settlement report follows.'),
  CLAIM_SUBMIT_FAILED: status('claim', 'failed', 'IAS rejected the claim', 'IAS rejected the submission; the reason was emailed to the internal team.'),
  CSR_SENT: status('stp', 'done', 'Settlement report sent', 'STP claim: the settlement report was emailed to the customer.'),

  // API cases (docs/imp/day1/api-case-workflow.md, section 4)
  API_RECEIVED: status('intake', 'in_progress', 'Received from IAS', 'A new claim from IAS; waiting for its images in the console.'),
  API_MATERIALS_DOWNLOADED: status('intake', 'in_progress', 'Images downloaded', 'Console images are stored and waiting to be read.'),
  API_NO_DOCUMENTS: status('intake', 'waiting_customer', 'No documents', 'No console images after the waiting time; the customer is asked for documents.'),
  API_REPLY_RECEIVED: status('recognition', 'in_progress', 'Customer replied', 'The customer sent new documents; they will be read again.'),
  API_RECOGNIZED: status('recognition', 'in_progress', 'Read by AI', 'Documents were read; the member check runs next.'),
  API_MANUAL_REVIEW: status('recognition', 'needs_review', 'Needs manual reading', "The AI couldn't read the documents reliably; a person should check them."),
  API_MEMBER_REVIEW_REQUIRED: status('member', 'needs_review', 'Member check issue', "Member, coverage or bank details don't match IAS; held for internal review."),
  API_READY_FOR_DOCUMENT_CHECKING: status('documents', 'in_progress', 'Checking documents', 'The member check passed; the document checklist runs next.'),
  API_INCOMPLETE: status('documents', 'in_progress', 'Documents missing', 'Documents are missing; the claim will be revised with suspense and the customer asked.'),
  API_DOCUMENTS_REVIEW: status('documents', 'needs_review', 'Check before emailing customer', "Documents look incomplete, but the AI wasn't sure. The customer has NOT been emailed and IAS is unchanged: check the documents, then send the request or override the check."),
  // Uploaded on the case page (SYSTEM_4 E4-04): read and checked at once, then sent to the IAS console before the revision.
  API_UPLOAD_RECEIVED: status('recognition', 'in_progress', 'Uploaded — being read', 'Documents were uploaded on the case page; they are read and checked again on the next run, then sent to the IAS console.'),
  // New documents for a case waiting on them, put in the console by anyone — api-console-watch notices them,
  // api-material-download fetches them, and the case is checked again. API_DOCUMENTS_UPLOADED / API_UPLOAD_NOT_IN_CONSOLE:
  // case-page uploads from before 2026-10-19, which went to the console first.
  API_DOCUMENTS_UPLOADED: status('documents', 'in_progress', 'Uploaded — waiting for the console', 'Documents were uploaded to the IAS console from the case page; the console gives them a barcode (usually 15–30 minutes), then they are read and the case is checked again.'),
  API_NEW_DOCUMENTS: status('documents', 'in_progress', 'New documents in the console', 'New documents for this case appeared in the IAS console; they are downloaded and the case is checked again.'),
  API_UPLOAD_NOT_IN_CONSOLE: status('documents', 'needs_review', 'Upload not in the console', 'Documents uploaded from the case page have not appeared in the IAS console after the waiting time. Check the console; the case keeps being checked and continues once they appear.'),
  API_DOCUMENTS_UNSURE: status('documents', 'needs_review', "Check the AI's documents finding", "All documents passed, but the AI wasn't sure about some of them, or a person asked for something the AI can't check (see the review points). Check them against the documents, then confirm to continue — or request more information; IAS is unchanged."),
  API_DOCUMENTS_VERIFIED: status('documents', 'in_progress', 'Documents complete', 'Member and documents are checked; the IAS revision is being prepared.'),
  // Case-page uploads go to the IAS console after the document check; the revision waits for their barcodes.
  API_CONSOLE_BARCODE_PENDING: status('claim', 'in_progress', 'Waiting for console barcode', 'The uploaded documents were sent to the IAS console; the console creates the barcode about every 15 minutes. The system checks again on every run.'),
  API_CONSOLE_BARCODE_MISSING: status('claim', 'needs_review', 'Console barcode not received', 'The uploaded documents were sent to the IAS console, but no barcode came back within the expected time. The system keeps checking; check the console side.'),
  API_CONSOLE_UPLOAD_FAILED: status('claim', 'needs_review', 'Console upload refused', 'The console upload API refused the uploaded documents, or did not say where it filed them; the reason is in the case history. IAS is unchanged.'),
  API_READY_FOR_CLAIM_PREPARATION: status('claim', 'in_progress', 'Preparing the revision', 'Documents are checked and in the IAS console; the IAS revision is being prepared.'),
  API_CLAIM_PAYLOAD_PREPARED: status('claim', 'in_progress', 'Revision prepared', 'The IAS claim revision is built and about to be sent.'),
  API_CLAIM_SUSPENDED: status('claim', 'waiting_customer', 'Documents incomplete', "Revised in IAS with suspense; the missing documents are asked for, and the case continues once they are in the IAS console (uploaded on the case page or by the customer)."),
  API_CLAIM_REVISED: status('claim', 'done', 'Revised in IAS', 'Documents are complete; handed to JD3 for approval in IAS.'),
  API_CLAIM_REVISION_FAILED: status('claim', 'failed', 'IAS rejected the revision', 'IAS rejected the revision; the reason was emailed to the internal team.'),
  API_AWAITING_CSR: status('stp', 'in_progress', 'Waiting for settlement report', 'STP claim: waiting for IAS to produce the settlement report.'),
  API_CSR_SENT: status('stp', 'done', 'Settlement report sent', 'STP claim: the settlement report was emailed to the customer.'),
};

// Codes in a group — e.g. the "needs review" badge count.
function codesInGroup(group) {
  return Object.keys(CASE_STATUSES).filter((code) => CASE_STATUSES[code].group === group);
}

// The Overview chart's outcome of a case (2026-10-18), for business users: paid straight through, waiting for JD3's
// approval, waiting for the customer's documents, or still being processed (being read, waiting for a person, failed).
// Same rules as the Approvals page: an email claim created in IAS is STP or JD3 by its isStp; an API claim revised in
// IAS is always JD3 (API STP goes on to API_AWAITING_CSR).
const STP_STATUSES = new Set(['CSR_SENT', 'API_AWAITING_CSR', 'API_CSR_SENT']);
const INCOMPLETE_STATUSES = new Set(['INCOMPLETE', 'API_NO_DOCUMENTS', 'API_INCOMPLETE', 'API_CLAIM_SUSPENDED']);
const OUTCOMES = ['stp', 'approval', 'incomplete', 'processing'];

function outcomeOf(status, isStp) {
  if (STP_STATUSES.has(status) || (status === 'CLAIM_CREATED' && isStp === true)) return 'stp';
  if (status === 'CLAIM_CREATED' || status === 'API_CLAIM_REVISED') return 'approval';
  if (INCOMPLETE_STATUSES.has(status)) return 'incomplete';
  return 'processing';
}

module.exports = { CASE_STATUSES, MODULES, GROUPS, codesInGroup, OUTCOMES, outcomeOf };
