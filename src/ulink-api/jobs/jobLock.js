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
async function acquire(blockName, { staleMs = null } = {}) {
  // staleMs (the review lane): a lock held longer than this is taken over — its run stopped without releasing it.
  const [rows] = await sequelize.query(
    `insert into ${JobLock.tableName} (block_name, running, started_at)
     values (:blockName, true, now())
     on conflict (block_name) do update
       set running = true, started_at = now()
       where ${JobLock.tableName}.running = false
         ${staleMs ? `or ${JobLock.tableName}.started_at < now() - make_interval(secs => :staleSecs)` : ''}
     returning block_name`,
    { replacements: { blockName, staleSecs: staleMs ? staleMs / 1000 : 0 } }
  );
  return rows.length > 0;
}

// The review lane's "run again" flag (REVIEW_LANE_PRD 4.5): a trigger that came while a round was busy sets it; the busy
// run takes it (clears it) after its round and runs once more. take returns whether it was set.
// Keeps a long run's lock fresh (the review lane, each step), so a live run is never taken over as stale.
async function touch(blockName) {
  await JobLock.update({ startedAt: new Date() }, { where: { blockName, running: true } });
}

async function requestRerun(blockName) {
  await sequelize.query(
    `insert into ${JobLock.tableName} (block_name, running, rerun_requested_at) values (:blockName, false, now())
     on conflict (block_name) do update set rerun_requested_at = now()`,
    { replacements: { blockName } }
  );
}

async function takeRerun(blockName) {
  const [rows] = await sequelize.query(
    `update ${JobLock.tableName} set rerun_requested_at = null
     where block_name = :blockName and rerun_requested_at is not null returning block_name`,
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

module.exports = { acquire, release, isRunning, touch, requestRerun, takeRerun };
