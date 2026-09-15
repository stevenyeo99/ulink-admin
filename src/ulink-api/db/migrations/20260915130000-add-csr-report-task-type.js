'use strict';

// Adds CSR_REPORT to ulink_email_tasks.task_type — queued by ias-claim-stp
// (modules/ias-claim-stp/service.js) once an STP claim's settlement report is downloaded.
// Customer-facing, with an attachment (the downloaded PDF) — see
// modules/email-sender/templates.js's renderCsrReport. Same mechanics as
// 20260826120000-add-submission-not-recognized-task-type.js.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW', 'CSR_REPORT'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW'))`
    );
  },
};
