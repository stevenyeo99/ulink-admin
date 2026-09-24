'use strict';

// Phase 2c of the API case workflow (docs/imp/day1/api-case-workflow.md):
//
// - ulink_api_case_steps: one row per API job run per case — its input (the earlier jobs'
//   outputs it received), its output, and any error. The single source of an API job's data;
//   a re-run adds a row, so history is kept.
// - ulink_case_documents: case-level document records (console images), stored through the same
//   storage adapter as email attachments. Unique per case + barcode + filename; an existing
//   document is skipped, never replaced.
// - ulink_job_checkpoints: per-job state that isn't about one case — api-claim-intake keeps the
//   last date it listed successfully, so a missed day (outage) is caught up on the next run.
// - Drops ulink_cases.ias_api_claim / api_materials_result: never populated, replaced by the
//   step table.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const id = { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') };
      const caseRef = {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_cases', key: 'id' },
        onDelete: 'CASCADE',
      };

      await queryInterface.createTable('ulink_api_case_steps', {
        id,
        case_id: caseRef,
        job: { type: Sequelize.STRING, allowNull: false },
        status: { type: Sequelize.STRING, allowNull: false },
        input: { type: Sequelize.JSONB, allowNull: true },
        output: { type: Sequelize.JSONB, allowNull: true },
        error: { type: Sequelize.TEXT, allowNull: true },
        started_at: { type: Sequelize.DATE, allowNull: false },
        finished_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      }, { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE ulink_api_case_steps ADD CONSTRAINT ulink_api_case_steps_status_check CHECK (status IN ('DONE', 'WAITING', 'FAILED'))",
        { transaction }
      );
      await queryInterface.addIndex('ulink_api_case_steps', ['case_id', 'job', 'created_at'], { transaction });

      await queryInterface.createTable('ulink_case_documents', {
        id,
        case_id: caseRef,
        origin: { type: Sequelize.STRING, allowNull: false },
        barcode_id: { type: Sequelize.TEXT, allowNull: false },
        scan_id: { type: Sequelize.TEXT, allowNull: true },
        original_filename: { type: Sequelize.TEXT, allowNull: false },
        content_type: { type: Sequelize.TEXT, allowNull: true },
        size_bytes: { type: Sequelize.INTEGER, allowNull: true },
        storage_ref: { type: Sequelize.TEXT, allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      }, { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE ulink_case_documents ADD CONSTRAINT ulink_case_documents_origin_check CHECK (origin IN ('CONSOLE'))",
        { transaction }
      );
      await queryInterface.addIndex('ulink_case_documents', ['case_id', 'barcode_id', 'original_filename'], {
        name: 'ulink_case_documents_unique_file',
        unique: true,
        transaction,
      });

      await queryInterface.createTable('ulink_job_checkpoints', {
        job: { type: Sequelize.STRING, primaryKey: true },
        value: { type: Sequelize.JSONB, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      }, { transaction });

      await queryInterface.removeColumn('ulink_cases', 'ias_api_claim', { transaction });
      await queryInterface.removeColumn('ulink_cases', 'api_materials_result', { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('ulink_cases', 'api_materials_result', { type: Sequelize.JSONB, allowNull: true }, { transaction });
      await queryInterface.addColumn('ulink_cases', 'ias_api_claim', { type: Sequelize.JSONB, allowNull: true }, { transaction });
      await queryInterface.dropTable('ulink_job_checkpoints', { transaction });
      await queryInterface.dropTable('ulink_case_documents', { transaction });
      await queryInterface.dropTable('ulink_api_case_steps', { transaction });
    });
  },
};
