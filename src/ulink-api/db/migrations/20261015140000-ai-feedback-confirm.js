'use strict';

// "✓ Right" in the review workspace (SYSTEM_4 E4-20, E5b): a reviewer confirms the AI's value or verdict. Kept as a
// third feedback kind, `confirm`, so learning sees agreement as well as corrections (how often the AI is right at each
// confidence). A confirmation has no "which step was wrong", so wrong_step becomes optional (a CHECK ... IN passes NULL).
// One confirmation per person per item and value: a unique index, so a double click can't count twice.
// down: confirmations are removed first — they would break the restored constraints.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback DROP CONSTRAINT ulink_ai_feedback_kind_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_kind_check CHECK (kind IN ('value', 'verdict', 'confirm'))", { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback ALTER COLUMN wrong_step DROP NOT NULL', { transaction });
      await queryInterface.sequelize.query(
        "CREATE UNIQUE INDEX ulink_ai_feedback_confirm_once ON ulink_ai_feedback (case_id, item, created_by, corrected_value) WHERE kind = 'confirm'",
        { transaction }
      );
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS ulink_ai_feedback_confirm_once', { transaction });
      await queryInterface.sequelize.query("DELETE FROM ulink_ai_feedback WHERE kind = 'confirm'", { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback ALTER COLUMN wrong_step SET NOT NULL', { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_ai_feedback DROP CONSTRAINT ulink_ai_feedback_kind_check', { transaction });
      await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_kind_check CHECK (kind IN ('value', 'verdict'))", { transaction });
    });
  },
};
