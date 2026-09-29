// Switches changed from the console — see migrations/20260929130000-create-settings.js and
// modules/settings/settings.js (defaults).
module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define(
    'Setting',
    {
      key: { type: DataTypes.TEXT, primaryKey: true },
      value: { type: DataTypes.JSONB, allowNull: false },
      updatedBy: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_settings' }
  );
  return Setting;
};
