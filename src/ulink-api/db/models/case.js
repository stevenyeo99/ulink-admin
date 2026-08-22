module.exports = (sequelize, DataTypes) => {
  const Case = sequelize.define(
    'Case',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      currentStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: 'EMAIL_RECEIVED' },
    },
    { tableName: 'ulink_cases' }
  );

  Case.associate = (models) => {
    Case.hasMany(models.EmailThread, { foreignKey: 'caseId' });
    Case.hasMany(models.CaseEvent, { foreignKey: 'caseId' });
  };

  return Case;
};
