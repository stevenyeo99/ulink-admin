'use strict';

// Every call the system makes to the AI (LM Studio): which case and job, which prompt and version, model, status,
// time, size, the answer and its confidence (SYSTEM_4 E4-26). For tracing an AI answer back to what produced it, and
// for measuring the AI before and after a prompt change. Not the input text or page images — both are already on
// the case. Written by modules/llm-calls; kept with no time limit for now (owner, 2026-10-14).

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_llm_calls', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      caseId: { type: Sequelize.UUID, allowNull: true, field: 'case_id', references: { model: 'ulink_cases', key: 'id' }, onDelete: 'SET NULL' },
      job: { type: Sequelize.STRING, allowNull: true },
      callType: { type: Sequelize.STRING, allowNull: false, field: 'call_type' },
      promptName: { type: Sequelize.STRING, allowNull: true, field: 'prompt_name' },
      promptVersion: { type: Sequelize.STRING, allowNull: true, field: 'prompt_version' },
      model: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false },
      durationMs: { type: Sequelize.INTEGER, allowNull: true, field: 'duration_ms' },
      promptTokens: { type: Sequelize.INTEGER, allowNull: true, field: 'prompt_tokens' },
      completionTokens: { type: Sequelize.INTEGER, allowNull: true, field: 'completion_tokens' },
      estimatedTokens: { type: Sequelize.INTEGER, allowNull: true, field: 'estimated_tokens' },
      output: { type: Sequelize.TEXT, allowNull: true },
      confidence: { type: Sequelize.FLOAT, allowNull: true },
      error: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
    });
    await queryInterface.sequelize.query(
      "ALTER TABLE ulink_llm_calls ADD CONSTRAINT ulink_llm_calls_status_check CHECK (status IN ('ok', 'error', 'timeout', 'too_long'))"
    );
    await queryInterface.addIndex('ulink_llm_calls', ['case_id', 'created_at'], { name: 'ulink_llm_calls_case_idx' });
    await queryInterface.addIndex('ulink_llm_calls', ['prompt_name', 'prompt_version', 'created_at'], { name: 'ulink_llm_calls_prompt_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_llm_calls');
  },
};
