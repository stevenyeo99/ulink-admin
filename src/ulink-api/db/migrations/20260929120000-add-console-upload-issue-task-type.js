'use strict';

// Adds CONSOLE_UPLOAD_ISSUE to ulink_email_tasks.task_type — internal-only notice when a cl-upload case
// needs a person: case number unclear, upload refused, or no console barcode in time
// (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md). Keep in step with the
// EmailTask model's own list (db/models/emailTask.js; tests/emailTaskTypes.test.js).

const BEFORE = "'MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW', 'CSR_REPORT', 'DOCUMENTS_INCOMPLETE'";

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
  up: (queryInterface) => setTypes(queryInterface, `${BEFORE}, 'CONSOLE_UPLOAD_ISSUE'`),
  down: (queryInterface) => setTypes(queryInterface, BEFORE),
};
