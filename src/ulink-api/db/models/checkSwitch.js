// AI checklist switches (SYSTEM_5 phase B) — see migrations/20261026120000-create-check-switches.js and
// modules/ai-checklist/switches.js. Append-only: the latest row for a code is its state.
module.exports = (sequelize, DataTypes) => {
  const CheckSwitch = sequelize.define(
    'CheckSwitch',
    {
      code: { type: DataTypes.TEXT, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      changedBy: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'ulink_check_switches' }
  );
  return CheckSwitch;
};
