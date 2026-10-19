// A document that belongs to the case itself, not to an email message — today, console images
// downloaded for an API case (origin CONSOLE) and documents uploaded on an API case page (origin
// UPLOAD). Stored through the same storage adapter as email attachments; reply attachments stay in
// ulink_email_attachments.
module.exports = (sequelize, DataTypes) => {
  const CaseDocument = sequelize.define(
    'CaseDocument',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      origin: { type: DataTypes.STRING, allowNull: false },
      barcodeId: { type: DataTypes.TEXT, allowNull: true }, // null: uploaded on the case page, not in the console yet
      scanId: { type: DataTypes.TEXT, allowNull: true },
      originalFilename: { type: DataTypes.TEXT, allowNull: false },
      contentType: { type: DataTypes.TEXT, allowNull: true },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: true },
      storageRef: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'ulink_case_documents', updatedAt: false }
  );

  CaseDocument.associate = (models) => {
    CaseDocument.belongsTo(models.Case, { foreignKey: 'caseId' });
  };

  return CaseDocument;
};
