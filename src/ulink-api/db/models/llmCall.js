// One call to the AI (LM Studio) — see migrations/20261014100000-create-llm-calls.js and modules/llm-calls.
module.exports = (sequelize, DataTypes) => {
  const LlmCall = sequelize.define(
    'LlmCall',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: true },
      job: { type: DataTypes.STRING, allowNull: true },
      // vision: reading one page image; text: a JSON answer from text (claim type, fields, judgments, picks, …).
      callType: { type: DataTypes.STRING, allowNull: false },
      promptName: { type: DataTypes.STRING, allowNull: true },
      promptVersion: { type: DataTypes.STRING, allowNull: true },
      model: { type: DataTypes.STRING, allowNull: true },
      // too_long: refused before sending — the text wouldn't fit the model's context (SYSTEM_4 E4-27).
      status: { type: DataTypes.STRING, allowNull: false, validate: { isIn: [['ok', 'error', 'timeout', 'too_long']] } },
      durationMs: { type: DataTypes.INTEGER, allowNull: true },
      promptTokens: { type: DataTypes.INTEGER, allowNull: true },
      completionTokens: { type: DataTypes.INTEGER, allowNull: true },
      estimatedTokens: { type: DataTypes.INTEGER, allowNull: true },
      output: { type: DataTypes.TEXT, allowNull: true },
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_llm_calls', updatedAt: false }
  );
  return LlmCall;
};
