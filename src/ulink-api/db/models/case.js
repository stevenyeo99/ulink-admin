const { leavesLane } = require('../../modules/review-lane/marker');

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
      // SYSTEM_5 review lane: set when a person decided the case, cleared at its next stop, wait or end
      // (modules/review-lane). While set, only the review lane processes the case.
      reviewPendingAt: { type: DataTypes.DATE, allowNull: true },
      reviewPendingBy: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_cases' }
  );

  // A status update that takes the case out of the review lane (its next stop, wait or end) also clears the marker
  // (SYSTEM_5 review lane 4.1.3): one rule for every job of both flows. Also when the update sets the marker: a person's
  // action that ends at a stop or a wait (a request to the customer) leaves nothing for the lane to do.
  Case.addHook('beforeBulkUpdate', (options) => {
    const values = options.attributes;
    if (typeof values?.currentStatus !== 'string' || !leavesLane(values.currentStatus)) return;
    values.reviewPendingAt = null;
    values.reviewPendingBy = null;
    if (Array.isArray(options.fields)) options.fields.push(...['reviewPendingAt', 'reviewPendingBy'].filter((f) => !options.fields.includes(f)));
  });

  Case.associate = (models) => {
    Case.hasMany(models.EmailThread, { foreignKey: 'caseId' });
    Case.hasMany(models.CaseEvent, { foreignKey: 'caseId' });
    Case.hasMany(models.EmailTask, { foreignKey: 'caseId' });
    Case.hasMany(models.ApiCaseStep, { foreignKey: 'caseId' });
    Case.hasMany(models.CaseDocument, { foreignKey: 'caseId' });
  };

  return Case;
};
