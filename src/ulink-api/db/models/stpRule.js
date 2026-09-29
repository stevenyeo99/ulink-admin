// One STP rule per case type (EMAIL / API) + IAS benefit type + currency — see
// migrations/20260929100000-stp-rules.js. Read by ias-claim-preparation/stpEligibility.js,
// edited from the console Settings page.
module.exports = (sequelize, DataTypes) => {
  const StpRule = sequelize.define(
    'StpRule',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseSource: { type: DataTypes.TEXT, allowNull: false },
      benefitType: { type: DataTypes.TEXT, allowNull: false },
      currency: { type: DataTypes.TEXT, allowNull: false },
      stpAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      amountLimit: { type: DataTypes.DECIMAL, allowNull: true },
    },
    { tableName: 'ulink_stp_rules' }
  );

  return StpRule;
};
