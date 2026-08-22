const { sequelize, JobLock } = require('../db/models');

/**
 * Atomically claim a job lock. Returns true if this call acquired the lock
 * (caller should run the job), false if another run is already in progress
 * (caller should skip without doing work).
 *
 * This is a compare-and-swap that Sequelize's model API can't express
 * atomically, so it goes through sequelize.query() directly — still using
 * Sequelize's connection/pool, just not the high-level query builder.
 */
async function acquire(blockName) {
  const [rows] = await sequelize.query(
    `insert into ${JobLock.tableName} (block_name, running, started_at)
     values (:blockName, true, now())
     on conflict (block_name) do update
       set running = true, started_at = now()
       where ${JobLock.tableName}.running = false
     returning block_name`,
    { replacements: { blockName } }
  );
  return rows.length > 0;
}

async function release(blockName) {
  await JobLock.update({ running: false }, { where: { blockName } });
}

async function isRunning(blockName) {
  const lock = await JobLock.findByPk(blockName);
  return Boolean(lock && lock.running);
}

module.exports = { acquire, release, isRunning };
