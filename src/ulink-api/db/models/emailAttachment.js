module.exports = (sequelize, DataTypes) => {
  const EmailAttachment = sequelize.define(
    'EmailAttachment',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      messageId: { type: DataTypes.UUID, allowNull: false },
      storageRef: { type: DataTypes.TEXT, allowNull: false },
      originalFilename: { type: DataTypes.TEXT, allowNull: true },
      contentType: { type: DataTypes.TEXT, allowNull: true },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: 'ulink_email_attachments', updatedAt: false }
  );

  EmailAttachment.associate = (models) => {
    EmailAttachment.belongsTo(models.EmailMessage, { foreignKey: 'messageId' });
  };

  return EmailAttachment;
};
