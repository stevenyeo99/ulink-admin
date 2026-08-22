module.exports = (sequelize, DataTypes) => {
  const CaseEvent = sequelize.define(
    'CaseEvent',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      blockName: { type: DataTypes.STRING, allowNull: false },
      prevStatus: { type: DataTypes.STRING, allowNull: true },
      newStatus: { type: DataTypes.STRING, allowNull: false },
      reasonCode: { type: DataTypes.STRING, allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      rawRef: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: 'ulink_case_events', updatedAt: false }
  );

  CaseEvent.associate = (models) => {
    CaseEvent.belongsTo(models.Case, { foreignKey: 'caseId' });
  };

  return CaseEvent;
};
