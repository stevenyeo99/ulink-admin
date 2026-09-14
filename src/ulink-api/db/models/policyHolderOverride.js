module.exports = (sequelize, DataTypes) => {
  const PolicyHolderOverride = sequelize.define(
    'PolicyHolderOverride',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      routeKey: { type: DataTypes.TEXT, allowNull: true },
      policyHolderName: { type: DataTypes.TEXT, allowNull: true },
      coverageArea: { type: DataTypes.TEXT, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'ulink_policy_holder_overrides' }
  );

  return PolicyHolderOverride;
};
