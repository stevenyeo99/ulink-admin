module.exports = (sequelize, DataTypes) => {
  const Case = sequelize.define(
    'Case',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      currentStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'EMAIL_RECEIVED' },
      recognizedType: { type: DataTypes.STRING, allowNull: true },
      extractedFields: { type: DataTypes.JSONB, allowNull: true },
      documentCheckResult: { type: DataTypes.JSONB, allowNull: true },
      memberVerifyResult: { type: DataTypes.JSONB, allowNull: true },
      iasMemberInfoResponse: { type: DataTypes.JSONB, allowNull: true },
      iasClaimPayload: { type: DataTypes.JSONB, allowNull: true },
      claimPrepMeta: { type: DataTypes.JSONB, allowNull: true },
      claimNo: { type: DataTypes.TEXT, allowNull: true },
      iasClaimResult: { type: DataTypes.JSONB, allowNull: true },
      consoleUploadResult: { type: DataTypes.JSONB, allowNull: true },
      consoleBarcode: { type: DataTypes.TEXT, allowNull: true },
      isStp: { type: DataTypes.BOOLEAN, allowNull: true },
    },
    { tableName: 'ulink_cases' }
  );

  Case.associate = (models) => {
    Case.hasMany(models.EmailThread, { foreignKey: 'caseId' });
    Case.hasMany(models.CaseEvent, { foreignKey: 'caseId' });
    Case.hasMany(models.EmailTask, { foreignKey: 'caseId' });
  };

  return Case;
};
