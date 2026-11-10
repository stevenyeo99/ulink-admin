// IAS benefit type + head pairs that never go STP (e.g. OP/VACC), whatever the benefit type rule says.
module.exports = (sequelize, DataTypes) => {
  const StpBlockedBenefit = sequelize.define(
    'StpBlockedBenefit',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      benefitType: { type: DataTypes.TEXT, allowNull: false },
      benefitHead: { type: DataTypes.TEXT, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_stp_blocked_benefits', indexes: [{ unique: true, fields: ['benefit_type', 'benefit_head'] }] }
  );

  return StpBlockedBenefit;
};
