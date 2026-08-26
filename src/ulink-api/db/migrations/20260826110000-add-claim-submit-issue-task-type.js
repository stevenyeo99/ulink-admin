'use strict';

// Adds CLAIM_SUBMIT_ISSUE to ulink_email_tasks.task_type — customer-facing email queued by
// ias-claim-creation when IAS returns a real business rejection (e.g. "Claim already
// exists"), Case.currentStatus=CLAIM_SUBMIT_FAILED. Previously silent to the customer (see
// ias-claim-creation/service.js's persistOutcome comment history) — only a CaseEvent was
// logged, nothing visible outside the admin console/DB. Same mechanics as
// 20260826100000-add-member-verify-issue-task-type.js.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE'))`
    );
  },
};
