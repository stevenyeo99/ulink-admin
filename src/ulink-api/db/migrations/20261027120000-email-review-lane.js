'use strict';

// SYSTEM_5 review lane, phase B (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md): the email flow gets its own review lane;
// its pipeline runs are 'EMAIL_REVIEW'.

const constraint = (values) => `ALTER TABLE ulink_pipeline_runs ADD CONSTRAINT ulink_pipeline_runs_pipeline_check CHECK (pipeline IN (${values.map((v) => `'${v}'`).join(', ')}))`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('ALTER TABLE ulink_pipeline_runs DROP CONSTRAINT ulink_pipeline_runs_pipeline_check', { transaction });
      await queryInterface.sequelize.query(constraint(['EMAIL', 'API', 'API_REVIEW', 'EMAIL_REVIEW']), { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("DELETE FROM ulink_pipeline_runs WHERE pipeline = 'EMAIL_REVIEW'", { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_pipeline_runs DROP CONSTRAINT ulink_pipeline_runs_pipeline_check', { transaction });
      await queryInterface.sequelize.query(constraint(['EMAIL', 'API', 'API_REVIEW']), { transaction });
    });
  },
};
