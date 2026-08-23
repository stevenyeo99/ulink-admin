'use strict';

// Email Sender module (validators create tasks, this table queues them; a separate
// sender job actually sends). See docs/imp/day1/ULINK_STP_Lego_Block_Architecture.md's
// "Email Draft / Sender" block and modules/email-sender/service.js.

const UUID_PK = (Sequelize) => ({
  type: Sequelize.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: Sequelize.literal('gen_random_uuid()'),
});

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_email_tasks', {
      id: UUID_PK(Sequelize),
      case_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_cases', key: 'id' },
        onDelete: 'CASCADE',
      },
      task_type: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PENDING' },
      // Stable signature of the content (e.g. sorted issue list joined) — lets the
      // producer (document-checking) tell "same issues as last time, don't re-queue"
      // apart from "issues changed since last email, queue a fresh one".
      dedupe_key: { type: Sequelize.TEXT, allowNull: true },
      // Snapshot of whatever the template needs (issues list, claimant name, case
      // number, ...) taken at creation time, so later Case mutation can't change an
      // already-queued email's content.
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      email_message_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'ulink_email_messages', key: 'id' },
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addIndex('ulink_email_tasks', ['status']);
    await queryInterface.addIndex('ulink_email_tasks', ['case_id', 'task_type']);

    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_task_type_check
       check (task_type in ('MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK'))`
    );
    await queryInterface.sequelize.query(
      `alter table ulink_email_tasks add constraint ulink_email_tasks_status_check
       check (status in ('PENDING', 'SENT', 'FAILED'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_email_tasks');
  },
};
