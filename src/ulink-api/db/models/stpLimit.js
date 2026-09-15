module.exports = (sequelize, DataTypes) => {
  const StpLimit = sequelize.define(
    'StpLimit',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      routeKey: { type: DataTypes.TEXT, allowNull: false },
      currency: { type: DataTypes.TEXT, allowNull: false },
      amountLimit: { type: DataTypes.DECIMAL, allowNull: false },
    },
    { tableName: 'ulink_stp_limits' }
  );

  return StpLimit;
};
