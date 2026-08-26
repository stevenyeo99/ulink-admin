module.exports = (sequelize, DataTypes) => {
  const EmailTask = sequelize.define(
    'EmailTask',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      taskType: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIn: [['MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK', 'CLAIM_CREATED_NOTIFICATION', 'MEMBER_VERIFY_ISSUE']],
        },
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'PENDING',
        validate: { isIn: [['PENDING', 'SENT', 'FAILED']] },
      },
      dedupeKey: { type: DataTypes.TEXT, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      emailMessageId: { type: DataTypes.UUID, allowNull: true },
    },
    { tableName: 'ulink_email_tasks' }
  );

  EmailTask.associate = (models) => {
    EmailTask.belongsTo(models.Case, { foreignKey: 'caseId' });
    EmailTask.belongsTo(models.EmailMessage, { foreignKey: 'emailMessageId' });
  };

  return EmailTask;
};
