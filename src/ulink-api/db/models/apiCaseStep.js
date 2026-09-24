// One API job run for one case: the earlier jobs' outputs it received (input), what it produced
// (output), or why it failed. The latest DONE row per job is that job's output for the next job.
// See modules/api-pipeline/runApiJob.js and docs/imp/day1/api-case-workflow.md section 6.
module.exports = (sequelize, DataTypes) => {
  const ApiCaseStep = sequelize.define(
    'ApiCaseStep',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      job: { type: DataTypes.STRING, allowNull: false },
      // DONE: output handed to the next job. WAITING: nothing to do yet (e.g. console images not
      // uploaded), retried next run. FAILED: technical error, retried next run.
      status: { type: DataTypes.STRING, allowNull: false, validate: { isIn: [['DONE', 'WAITING', 'FAILED']] } },
      input: { type: DataTypes.JSONB, allowNull: true },
      output: { type: DataTypes.JSONB, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'ulink_api_case_steps' }
  );

  ApiCaseStep.associate = (models) => {
    ApiCaseStep.belongsTo(models.Case, { foreignKey: 'caseId' });
  };

  return ApiCaseStep;
};
