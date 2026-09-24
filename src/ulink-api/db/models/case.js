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
      // 'EMAIL' or 'API' — which workflow owns this case. Set once at creation; the DB only
      // lets an API case hold API_* statuses (docs/imp/day1/api-case-workflow.md section 3).
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'EMAIL' },
      tpaCaseNumber: { type: DataTypes.TEXT, allowNull: true },
      iasApiClaim: { type: DataTypes.JSONB, allowNull: true },
      // api-material-download's output: scanId, folder, and per-barcode downloaded files.
      apiMaterialsResult: { type: DataTypes.JSONB, allowNull: true },
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
