'use strict';

// Orchestrator (routes/jobs/pipeline.js + modules/pipeline/service.js) — a single
// POST /api/jobs/pipeline/run that chains all 7 block jobs in order for easier
// end-to-end testing, and gives a future progress UI something to poll. Two tables,
// not one JSONB blob: run-level (this migration's ulink_pipeline_runs) vs
// step-level (ulink_pipeline_run_steps) so a UI can render a live per-step stepper
// without parsing JSON. See docs/imp/day1/jobs-registry.md's "Orchestrator" section.

const UUID_PK = (Sequelize) => ({
  type: Sequelize.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: Sequelize.literal('gen_random_uuid()'),
});

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_pipeline_runs', {
      id: UUID_PK(Sequelize),
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'RUNNING' },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(
      `alter table ulink_pipeline_runs add constraint ulink_pipeline_runs_status_check
       check (status in ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'))`
    );

    await queryInterface.createTable('ulink_pipeline_run_steps', {
      id: UUID_PK(Sequelize),
      pipeline_run_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ulink_pipeline_runs', key: 'id' },
        onDelete: 'CASCADE',
      },
      block_name: { type: Sequelize.STRING, allowNull: false },
      sequence: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PENDING' },
      // Set only when status = SKIPPED — e.g. 'already_running' when this block's own
      // per-block lock (ulink_job_locks) was held by a concurrent individual cron trigger.
      skip_reason: { type: Sequelize.STRING, allowNull: true },
      // Whatever this block's service.run() resolved to — the same object
      // controllers/job/jobsController.js already logs for every individual job.
      result_summary: { type: Sequelize.JSONB, allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addIndex('ulink_pipeline_run_steps', ['pipeline_run_id']);

    await queryInterface.sequelize.query(
      `alter table ulink_pipeline_run_steps add constraint ulink_pipeline_run_steps_status_check
       check (status in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED'))`
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_pipeline_run_steps');
    await queryInterface.dropTable('ulink_pipeline_runs');
  },
};
