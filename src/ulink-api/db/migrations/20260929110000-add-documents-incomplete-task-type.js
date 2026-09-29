'use strict';

// Adds DOCUMENTS_INCOMPLETE to ulink_email_tasks.task_type — the internal copy of a missing-documents
// request, queued by document-checking next to the customer's MISSING_DOCUMENTS email (17/09 meeting
// notes, item 4). Internal-only (email-sender/service.js INTERNAL_ONLY_TASK_TYPES). Same mechanics as
// 20260915130000-add-csr-report-task-type.js.

const BEFORE = "'MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW', 'CSR_REPORT'";

async function setTypes(queryInterface, types) {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query('alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check', { transaction });
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check check (task_type in (${types}))`,
      { transaction }
    );
  });
}

module.exports = {
  up: (queryInterface) => setTypes(queryInterface, `${BEFORE}, 'DOCUMENTS_INCOMPLETE'`),
  down: (queryInterface) => setTypes(queryInterface, BEFORE),
};
