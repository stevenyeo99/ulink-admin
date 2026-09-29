// ICD-10 code prefixes that never go STP ("C" = every cancer code, "R69" = diagnosis not found).
module.exports = (sequelize, DataTypes) => {
  const StpBlockedDiagnosis = sequelize.define(
    'StpBlockedDiagnosis',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      codePrefix: { type: DataTypes.TEXT, allowNull: false, unique: true },
      note: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_stp_blocked_diagnoses' }
  );

  return StpBlockedDiagnosis;
};
