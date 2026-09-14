'use strict';

// Adds CLAIM_APPROVAL_REVIEW to ulink_email_tasks.task_type — ias-claim-creation's own
// internal notice once a claim is created in IAS, replacing CLAIM_CREATED_NOTIFICATION
// (which used to tell the customer their claim number automatically). Same mechanics as
// 20260826100000-add-member-verify-issue-task-type.js. CLAIM_CREATED_NOTIFICATION stays in
// the constraint even though nothing queues it anymore — no down-migration needed for a
// taskType that just goes unused.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED', 'CLAIM_APPROVAL_REVIEW'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED'))`
    );
  },
};
