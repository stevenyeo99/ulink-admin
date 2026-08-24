module.exports = (sequelize, DataTypes) => {
  const PipelineRun = sequelize.define(
    'PipelineRun',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'RUNNING',
        validate: { isIn: [['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED']] },
      },
      startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'ulink_pipeline_runs' }
  );

  PipelineRun.associate = (models) => {
    PipelineRun.hasMany(models.PipelineRunStep, { foreignKey: 'pipelineRunId' });
  };

  return PipelineRun;
};
