const jobLock = require('../../jobs/jobLock');
const logger = require('../../utils/logger');

/**
 * Builds the POST /api/jobs/<blockName>/run handler for one pipeline block's
 * service (Model/Service layer stays in modules/<block>/service.js — this
 * only handles the request: lock acquire/release and response shaping).
 * No auth for Day 1 (trusted host/network). Skip-if-already-running via
 * job_locks, per the confirmed overlap-handling decision.
 *
 * Fire-and-forget: responds as soon as the lock is acquired, then runs the
 * job in the background — the caller (crontab) never blocks on how long the
 * batch takes, and a stuck downstream call (IMAP/DB) can no longer hang the
 * HTTP request. Trade-off: the result/error is no longer in the response —
 * only in the server logs and the case data itself (CaseEvent rows) — this
 * doesn't fix a genuinely stuck call underneath, it just stops it from
 * blocking the caller. Add timeouts separately if hangs need to actually
 * resolve instead of running indefinitely in the background.
 */
function createRunHandler(blockName, service) {
  return async function runJob(req, res) {
    const acquired = await jobLock.acquire(blockName);
    if (!acquired) {
      return res.json({ block: blockName, skipped: true, reason: 'already_running' });
    }

    res.json({ block: blockName, started: true });

    service
      .run()
      .then((result) => {
        logger.info(`Job ${blockName} finished`, { block: blockName, ...result });
      })
      .catch((error) => {
        logger.error(`Job ${blockName} failed`, { error: error.message, stack: error.stack });
      })
      .finally(() => jobLock.release(blockName));
  };
}

/**
 * Builds the POST /api/jobs/<blockName>/release handler — manually clears a
 * stuck lock (e.g. the API process died mid-run, so the /run handler's
 * `finally` never got to call jobLock.release). Idempotent: safe to call
 * whether or not the lock was actually held.
 */
function createReleaseHandler(blockName) {
  return async function releaseJob(req, res) {
    const wasLocked = await jobLock.isRunning(blockName);
    await jobLock.release(blockName);
    res.json({ block: blockName, released: true, wasLocked });
  };
}

module.exports = { createRunHandler, createReleaseHandler };
