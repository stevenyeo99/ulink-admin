module.exports = (sequelize, DataTypes) => {
  const EmailThread = sequelize.define(
    'EmailThread',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      subjectHint: { type: DataTypes.TEXT, allowNull: true },
      firstMessageId: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_email_threads', updatedAt: false }
  );

  EmailThread.associate = (models) => {
    EmailThread.belongsTo(models.Case, { foreignKey: 'caseId' });
    EmailThread.hasMany(models.EmailMessage, { foreignKey: 'threadId' });
  };

  return EmailThread;
};
