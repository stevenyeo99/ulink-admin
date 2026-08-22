'use strict';

// Email Submission Recognition module - Lego block 1 (email thread + attachment intake).
// See docs/imp/day1/ULINK_STP_Email_Submission_Recognition_Module.md

const UUID_PK = (Sequelize) => ({
  type: Sequelize.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: Sequelize.literal('gen_random_uuid()'),
});

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('create extension if not exists pgcrypto');

    await queryInterface.createTable('ulink_cases', {
      id: UUID_PK(Sequelize),
      current_status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'EMAIL_RECEIVED' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.createTable('ulink_email_threads', {
      id: UUID_PK(Sequelize),
      case_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_cases', key: 'id' },
        onDelete: 'CASCADE',
      },
      subject_hint: { type: Sequelize.TEXT, allowNull: true },
      first_message_id: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.addIndex('ulink_email_threads', ['case_id']);
    await queryInterface.addIndex('ulink_email_threads', ['first_message_id']);

    await queryInterface.createTable('ulink_email_messages', {
      id: UUID_PK(Sequelize),
      thread_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_email_threads', key: 'id' },
        onDelete: 'CASCADE',
      },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'imap' },
      external_id: { type: Sequelize.TEXT, allowNull: true },
      // 'inbound' = arrived via the channel adapter's fetch side; 'outbound' = a
      // reply the system sent (channels/*.sendReply, not implemented yet).
      direction: { type: Sequelize.STRING, allowNull: false, defaultValue: 'inbound' },
      message_id: { type: Sequelize.TEXT, allowNull: true },
      in_reply_to: { type: Sequelize.TEXT, allowNull: true },
      references_header: { type: Sequelize.TEXT, allowNull: true },
      from_addr: { type: Sequelize.TEXT, allowNull: true },
      to_addr: { type: Sequelize.TEXT, allowNull: true },
      cc_addr: { type: Sequelize.TEXT, allowNull: true },
      subject: { type: Sequelize.TEXT, allowNull: true },
      body_text: { type: Sequelize.TEXT, allowNull: true },
      // Relevant to outbound only today (draft/queued/sent/failed); null for inbound.
      status: { type: Sequelize.STRING, allowNull: true },
      received_at: { type: Sequelize.DATE, allowNull: true },
      raw_size_bytes: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.addIndex('ulink_email_messages', ['thread_id']);
    await queryInterface.addIndex('ulink_email_messages', ['message_id']);
    await queryInterface.addIndex('ulink_email_messages', ['source', 'external_id'], {
      unique: true,
      name: 'ulink_email_messages_source_external_id_uk',
    });
    await queryInterface.sequelize.query(
      `alter table ulink_email_messages add constraint ulink_email_messages_direction_check
       check (direction in ('inbound', 'outbound'))`
    );

    await queryInterface.createTable('ulink_email_attachments', {
      id: UUID_PK(Sequelize),
      message_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_email_messages', key: 'id' },
        onDelete: 'CASCADE',
      },
      storage_ref: { type: Sequelize.TEXT, allowNull: false },
      original_filename: { type: Sequelize.TEXT, allowNull: true },
      content_type: { type: Sequelize.TEXT, allowNull: true },
      size_bytes: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.addIndex('ulink_email_attachments', ['message_id']);

    // One row per job type. Used for skip-if-already-running overlap
    // protection between cron-triggered runs of the same job endpoint.
    await queryInterface.createTable('ulink_job_locks', {
      block_name: { type: Sequelize.STRING, primaryKey: true },
      running: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      started_at: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.createTable('ulink_case_events', {
      id: UUID_PK(Sequelize),
      case_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_cases', key: 'id' },
        onDelete: 'CASCADE',
      },
      block_name: { type: Sequelize.STRING, allowNull: false },
      prev_status: { type: Sequelize.STRING, allowNull: true },
      new_status: { type: Sequelize.STRING, allowNull: false },
      reason_code: { type: Sequelize.STRING, allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: true },
      raw_ref: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.addIndex('ulink_case_events', ['case_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_case_events');
    await queryInterface.dropTable('ulink_job_locks');
    await queryInterface.dropTable('ulink_email_attachments');
    await queryInterface.dropTable('ulink_email_messages');
    await queryInterface.dropTable('ulink_email_threads');
    await queryInterface.dropTable('ulink_cases');
  },
};
