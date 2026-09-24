// Per-job state that isn't about one case, e.g. api-claim-intake's last successfully listed date.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'JobCheckpoint',
    {
      job: { type: DataTypes.STRING, primaryKey: true },
      value: { type: DataTypes.JSONB, allowNull: false },
    },
    { tableName: 'ulink_job_checkpoints', createdAt: false }
  );
