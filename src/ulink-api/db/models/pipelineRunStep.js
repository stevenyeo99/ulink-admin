module.exports = (sequelize, DataTypes) => {
  const PipelineRunStep = sequelize.define(
    'PipelineRunStep',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      pipelineRunId: { type: DataTypes.UUID, allowNull: false },
      blockName: { type: DataTypes.STRING, allowNull: false },
      sequence: { type: DataTypes.INTEGER, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'PENDING',
        validate: { isIn: [['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED']] },
      },
      skipReason: { type: DataTypes.STRING, allowNull: true },
      resultSummary: { type: DataTypes.JSONB, allowNull: true },
      errorMessage: { type: DataTypes.TEXT, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'ulink_pipeline_run_steps' }
  );

  PipelineRunStep.associate = (models) => {
    PipelineRunStep.belongsTo(models.PipelineRun, { foreignKey: 'pipelineRunId' });
  };

  return PipelineRunStep;
};
