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
      // Set only for a document fetched from a link found inside another attachment
      // (e.g. a generated claim PDF that references a photo by URL instead of embedding
      // it) — null for a genuine email MIME attachment.
      sourceUrl: { type: DataTypes.TEXT, allowNull: true },
      parentAttachmentId: { type: DataTypes.UUID, allowNull: true },
    },
    { tableName: 'ulink_email_attachments', updatedAt: false }
  );

  EmailAttachment.associate = (models) => {
    EmailAttachment.belongsTo(models.EmailMessage, { foreignKey: 'messageId' });
  };

  return EmailAttachment;
};
