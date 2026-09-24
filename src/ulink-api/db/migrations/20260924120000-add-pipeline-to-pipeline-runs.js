'use strict';

// Which orchestrator a run belongs to: 'EMAIL' (POST /api/jobs/pipeline/run, every existing
// row) or 'API' (POST /api/jobs/api-pipeline/run). The console shows each pipeline's runs on
// its own tab — see docs/imp/day1/api-case-workflow.md section 5.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('ulink_pipeline_runs', 'pipeline', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'EMAIL',
      }, { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE ulink_pipeline_runs ADD CONSTRAINT ulink_pipeline_runs_pipeline_check CHECK (pipeline IN ('EMAIL', 'API'))",
        { transaction }
      );
      await queryInterface.addIndex('ulink_pipeline_runs', ['pipeline', 'started_at'], { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_pipeline_runs', 'pipeline');
  },
};
