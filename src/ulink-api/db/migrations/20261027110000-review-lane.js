'use strict';

// SYSTEM_5 review lane (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md, owner 2026-10-27): a case a person decided is
// marked (review_pending_at, review_pending_by) and processed by its own pipeline, the review lane, until its next stop,
// wait or end. The lane's lock row keeps a "run again" flag (rerun_requested_at) for a trigger that came while a round
// was busy. Pipeline runs of the review lane are 'API_REVIEW'.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('ulink_cases', 'review_pending_at', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('ulink_cases', 'review_pending_by', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      await queryInterface.addIndex('ulink_cases', ['review_pending_at'], { name: 'ulink_cases_review_pending_at', where: { review_pending_at: { [Sequelize.Op.ne]: null } }, transaction });
      await queryInterface.addColumn('ulink_job_locks', 'rerun_requested_at', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_pipeline_runs DROP CONSTRAINT ulink_pipeline_runs_pipeline_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_pipeline_runs ADD CONSTRAINT ulink_pipeline_runs_pipeline_check CHECK (pipeline IN ('EMAIL', 'API', 'API_REVIEW'))", { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("DELETE FROM ulink_pipeline_runs WHERE pipeline = 'API_REVIEW'", { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_pipeline_runs DROP CONSTRAINT ulink_pipeline_runs_pipeline_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_pipeline_runs ADD CONSTRAINT ulink_pipeline_runs_pipeline_check CHECK (pipeline IN ('EMAIL', 'API'))", { transaction });
      await queryInterface.removeColumn('ulink_job_locks', 'rerun_requested_at', { transaction });
      await queryInterface.removeIndex('ulink_cases', 'ulink_cases_review_pending_at', { transaction });
      await queryInterface.removeColumn('ulink_cases', 'review_pending_by', { transaction });
      await queryInterface.removeColumn('ulink_cases', 'review_pending_at', { transaction });
    });
  },
};
