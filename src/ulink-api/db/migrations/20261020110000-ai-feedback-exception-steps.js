'use strict';

// "What went wrong?" on Mark OK / Mark wrong (owner, 2026-10-20): two answers for a check the AI got right that a person
// lets pass anyway — the IAS record is out of date, or an accepted exception. They are not AI mistakes, so the feedback
// report shows them apart from corrections. down: those rows become 'check' (the only answer before), then the
// constraint is restored.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback DROP CONSTRAINT ulink_ai_feedback_wrong_step_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_wrong_step_check CHECK (wrong_step IN ('reading', 'mapping', 'check', 'ias_outdated', 'exception'))", { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("UPDATE ulink_ai_feedback SET wrong_step = 'check' WHERE wrong_step IN ('ias_outdated', 'exception')", { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback DROP CONSTRAINT ulink_ai_feedback_wrong_step_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_wrong_step_check CHECK (wrong_step IN ('reading', 'mapping', 'check'))", { transaction });
    });
  },
};
