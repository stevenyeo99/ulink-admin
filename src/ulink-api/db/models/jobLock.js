module.exports = (sequelize, DataTypes) => {
  const JobLock = sequelize.define(
    'JobLock',
    {
      blockName: { type: DataTypes.STRING, primaryKey: true },
      running: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      startedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'ulink_job_locks', timestamps: false }
  );

  return JobLock;
};
