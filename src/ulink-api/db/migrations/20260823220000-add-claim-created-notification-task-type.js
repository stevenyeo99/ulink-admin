'use strict';

// Adds CLAIM_CREATED_NOTIFICATION to ulink_email_tasks.task_type — the customer-facing
// email queued by ias-claim-creation on a successful real claim submission (distinct from,
// and in addition to, DOCUMENT_COMPLETE_ACK which already fires at MEMBER_VERIFIED — both
// are kept, confirmed earlier). Same mechanics as 20260823150000-add-manual-review-alert-
// task-type.js (a fresh migration, not an edit to the original create-email-tasks
// migration, since that one is already applied) — that one was later reverted; this one is
// a real, kept addition.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK'))`
    );
  },
};
