'use strict';

// Adds MEMBER_VERIFY_ISSUE to ulink_email_tasks.task_type — member-verification's own
// email, distinct from MISSING_DOCUMENTS (which document-checking queues, and which
// member-verification previously reused for its own failures too). Same mechanics as
// 20260823220000-add-claim-created-notification-task-type.js.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION'))`
    );
  },
};
