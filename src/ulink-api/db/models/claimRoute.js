module.exports = (sequelize, DataTypes) => {
  const ClaimRoute = sequelize.define(
    'ClaimRoute',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      routeKey: { type: DataTypes.STRING, allowNull: false, unique: true },
      label: { type: DataTypes.STRING, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      insurer: { type: DataTypes.STRING, allowNull: true },
      claimType: { type: DataTypes.STRING, allowNull: true },
      extractionSchema: { type: DataTypes.JSONB, allowNull: false },
    },
    { tableName: 'ulink_claim_routes' }
  );

  return ClaimRoute;
};
