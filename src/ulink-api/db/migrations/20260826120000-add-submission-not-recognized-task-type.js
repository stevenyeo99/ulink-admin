'use strict';

// Adds SUBMISSION_NOT_RECOGNIZED to ulink_email_tasks.task_type — queued by
// claim-recognition when a submission doesn't match any enabled claim route
// (Case.currentStatus=NOT_RECOGNIZED). Previously silent to the sender — only a CaseEvent
// was logged, no reply at all, same gap CLAIM_SUBMIT_ISSUE closed for the claim-creation
// stage. Deliberately NOT queued for MANUAL_REVIEW (a route DID match, just at low
// confidence — that's still "our job", just needs a human look, not a "go elsewhere"
// message). Same mechanics as 20260826110000-add-claim-submit-issue-task-type.js.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE', 'SUBMISSION_NOT_RECOGNIZED'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'alter table ulink_email_tasks drop constraint ulink_email_tasks_task_type_check'
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE', 'CLAIM_SUBMIT_ISSUE'))`
    );
  },
};
