'use strict';

// A reviewer's correction of one thing the AI got wrong (SYSTEM_4 E4-12, E4-15 steps 0–1): a value it read (NRC,
// date, amount, …) or a check's verdict. The learning record — what the AI said and how sure, what the person
// corrected it to, why, which step was wrong (reading the page / mapping the fields / the check's decision), on which
// page — and the trusted mark a second person gives before a correction may teach the AI (later phases).
// What the flow uses is the case's own fields (extractedFields.corrections, modules/ai-feedback/corrections.js).

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_ai_feedback', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      caseId: { type: Sequelize.UUID, allowNull: false, field: 'case_id', references: { model: 'ulink_cases', key: 'id' }, onDelete: 'CASCADE' },
      kind: { type: Sequelize.STRING, allowNull: false },
      item: { type: Sequelize.STRING, allowNull: false },
      label: { type: Sequelize.STRING, allowNull: false },
      aiValue: { type: Sequelize.JSONB, allowNull: true, field: 'ai_value' },
      aiConfidence: { type: Sequelize.FLOAT, allowNull: true, field: 'ai_confidence' },
      correctedValue: { type: Sequelize.JSONB, allowNull: true, field: 'corrected_value' },
      reason: { type: Sequelize.TEXT, allowNull: false },
      wrongStep: { type: Sequelize.STRING, allowNull: false, field: 'wrong_step' },
      page: { type: Sequelize.STRING, allowNull: true },
      createdBy: { type: Sequelize.STRING, allowNull: false, field: 'created_by' },
      trusted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      trustedBy: { type: Sequelize.STRING, allowNull: true, field: 'trusted_by' },
      trustedAt: { type: Sequelize.DATE, allowNull: true, field: 'trusted_at' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
    });
    await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_kind_check CHECK (kind IN ('value', 'verdict'))");
    await queryInterface.sequelize.query("ALTER TABLE ulink_ai_feedback ADD CONSTRAINT ulink_ai_feedback_wrong_step_check CHECK (wrong_step IN ('reading', 'mapping', 'check'))");
    await queryInterface.addIndex('ulink_ai_feedback', ['case_id', 'created_at'], { name: 'ulink_ai_feedback_case_idx' });
    await queryInterface.addIndex('ulink_ai_feedback', ['item', 'trusted'], { name: 'ulink_ai_feedback_item_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_ai_feedback');
  },
};
