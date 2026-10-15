// A reviewer's correction of one AI value or check verdict, or a confirmation that the AI was right — see
// migrations/20261015120000-create-ai-feedback.js, 20261015140000-ai-feedback-confirm.js and modules/ai-feedback.
// KINDS / WRONG_STEPS must match the table's check constraints (tests/aiFeedback.test.js guards that).
const KINDS = ['value', 'verdict', 'confirm'];
const WRONG_STEPS = ['reading', 'mapping', 'check'];

module.exports = (sequelize, DataTypes) => {
  const AiFeedback = sequelize.define(
    'AiFeedback',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      kind: { type: DataTypes.STRING, allowNull: false, validate: { isIn: [KINDS] } },
      item: { type: DataTypes.STRING, allowNull: false },
      label: { type: DataTypes.STRING, allowNull: false },
      aiValue: { type: DataTypes.JSONB, allowNull: true },
      aiConfidence: { type: DataTypes.FLOAT, allowNull: true },
      correctedValue: { type: DataTypes.JSONB, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: false },
      // null for a confirmation (nothing was wrong).
      wrongStep: { type: DataTypes.STRING, allowNull: true, validate: { isIn: [WRONG_STEPS] } },
      page: { type: DataTypes.STRING, allowNull: true },
      createdBy: { type: DataTypes.STRING, allowNull: false },
      trusted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      trustedBy: { type: DataTypes.STRING, allowNull: true },
      trustedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'ulink_ai_feedback' }
  );
  AiFeedback.KINDS = KINDS;
  AiFeedback.WRONG_STEPS = WRONG_STEPS;
  return AiFeedback;
};
