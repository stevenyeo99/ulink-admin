// Every email type a job queues must be allowed by the EmailTask model (and the DB check constraint).
// Regression: DOCUMENTS_INCOMPLETE was added to the DB constraint but not the model's list, so the
// document check's save failed ("Validation isIn on taskType failed") and the case stayed stuck at
// READY_FOR_DOCUMENT_CHECKING (2026-09-29). Validation runs in memory — no DB needed.

const { EmailTask } = require('../db/models');

const QUEUED_TYPES = [
  'MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE',
  'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW', 'CSR_REPORT', 'DOCUMENTS_INCOMPLETE',
];

it.each(QUEUED_TYPES)('accepts %s', async (taskType) => {
  await expect(EmailTask.build({ caseId: '00000000-0000-0000-0000-000000000000', taskType, status: 'PENDING', payload: {} }).validate()).resolves.toBeTruthy();
});
