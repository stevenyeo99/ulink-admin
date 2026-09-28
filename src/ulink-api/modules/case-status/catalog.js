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
  INCOMPLETE: status('documents', 'waiting_customer', 'Waiting for documents', 'Documents are missing or unclear; the customer was emailed the list.'),
  MEMBER_VERIFIED: status('documents', 'in_progress', 'Checks passed', 'Member and documents are checked; documents go to the console next.'),
  DOCUMENTS_UPLOADED: status('claim', 'in_progress', 'Documents uploaded', 'Documents are in the console; the IAS claim is being prepared.'),
  CLAIM_PAYLOAD_PREPARED: status('claim', 'in_progress', 'Claim prepared', 'The IAS claim is built and about to be submitted.'),
  CLAIM_CREATED: status('claim', 'done', 'Created in IAS', 'The claim is in IAS. Non-STP: waiting for JD2 approval. STP: the settlement report follows.'),
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
  API_DOCUMENTS_VERIFIED: status('documents', 'in_progress', 'Documents complete', 'Member and documents are checked; the IAS revision is being prepared.'),
  API_CLAIM_PAYLOAD_PREPARED: status('claim', 'in_progress', 'Revision prepared', 'The IAS claim revision is built and about to be sent.'),
  API_CLAIM_SUSPENDED: status('claim', 'waiting_customer', 'Waiting for documents', "Revised in IAS with suspense; waiting for the customer's documents."),
  API_CLAIM_REVISED: status('claim', 'done', 'Revised in IAS', 'Documents are complete; handed to JD2 for approval in IAS.'),
  API_CLAIM_REVISION_FAILED: status('claim', 'failed', 'IAS rejected the revision', 'IAS rejected the revision; the reason was emailed to the internal team.'),
  API_AWAITING_CSR: status('stp', 'in_progress', 'Waiting for settlement report', 'STP claim: waiting for IAS to produce the settlement report.'),
  API_CSR_SENT: status('stp', 'done', 'Settlement report sent', 'STP claim: the settlement report was emailed to the customer.'),
};

// Codes in a group — e.g. the "needs review" badge count.
function codesInGroup(group) {
  return Object.keys(CASE_STATUSES).filter((code) => CASE_STATUSES[code].group === group);
}

module.exports = { CASE_STATUSES, MODULES, GROUPS, codesInGroup };
