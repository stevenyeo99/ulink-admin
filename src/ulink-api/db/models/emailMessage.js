module.exports = (sequelize, DataTypes) => {
  const EmailMessage = sequelize.define(
    'EmailMessage',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      threadId: { type: DataTypes.UUID, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'imap' },
      externalId: { type: DataTypes.TEXT, allowNull: true },
      direction: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'inbound',
        validate: { isIn: [['inbound', 'outbound']] },
      },
      messageId: { type: DataTypes.TEXT, allowNull: true },
      inReplyTo: { type: DataTypes.TEXT, allowNull: true },
      referencesHeader: { type: DataTypes.TEXT, allowNull: true },
      fromAddr: { type: DataTypes.TEXT, allowNull: true },
      toAddr: { type: DataTypes.TEXT, allowNull: true },
      ccAddr: { type: DataTypes.TEXT, allowNull: true },
      subject: { type: DataTypes.TEXT, allowNull: true },
      bodyText: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: true },
      receivedAt: { type: DataTypes.DATE, allowNull: true },
      rawSizeBytes: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: 'ulink_email_messages', updatedAt: false }
  );

  EmailMessage.associate = (models) => {
    EmailMessage.belongsTo(models.EmailThread, { foreignKey: 'threadId' });
    EmailMessage.hasMany(models.EmailAttachment, { foreignKey: 'messageId' });
  };

  return EmailMessage;
};
