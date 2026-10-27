const { Op } = require('sequelize');
const { Case, JobLock, PipelineRun, PipelineRunStep } = require('../../db/models');
const jobLock = require('../../jobs/jobLock');
const { getSettings } = require('../settings/settings');
const logger = require('../../utils/logger');

// The API review lane (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md 4.3 to 4.5): the existing API jobs, in the same order,
// on the cases a person decided only (marker.js). Its own pipeline lock and job lock names, so it never waits for the
// existing pipeline and the existing pipeline never waits for it. One round at a time: a trigger while a round is busy
// sets the "run again" flag, and the busy run does one more round. Started by a person's save (trigger), the retry cron
// and a manual run.
const LOCK = 'api-review-pipeline';
const PIPELINE = 'API_REVIEW';
// A lock older than this is a run that stopped without releasing it (an API restart): the next trigger takes it over.
const STALE_MS = 15 * 60 * 1000;
// A case still marked after this is no longer the lane's (a job that keeps failing or waiting): its marker is cleared,
// and the existing pipeline takes it on its next run, as before the lane (REVIEW_LANE_PRD risk 2).
const GIVE_UP_MS = 30 * 60 * 1000;
// The jobs a decided case can need until its next stop, wait or end. Not intake, console watch, the download, the
// barcode or the settlement report: the case leaves the lane before those (marker.js OUTSIDE_WAITS).
const REVIEW_JOBS = ['api-claim-recognition', 'api-member-verification', 'api-document-checking', 'api-console-upload', 'api-claim-preparation', 'api-claim-revision'];

const MARKED = { source: 'API', reviewPendingAt: { [Op.ne]: null } };
// Cases a person asked to run first while a round was busy: the next round takes them first.
// ponytail: kept in memory — one API process; move to the lock row if the API ever runs as several processes.
const queuedFirst = new Set();

// One round: each job over the marked cases at its input status, then the emails of every API case that moved during
// the round (a case marked or leaving the lane meanwhile too). No round, and no run in the history, with nothing marked.
async function round(first) {
  // Required here, not at the top: pipeline/service.js loads every job module.
  const { API_STEPS, runStep, startRun } = require('../pipeline/service');
  const emailSender = require('../api-email-sender/service');
  const gaveUp = await Case.update({ reviewPendingAt: null, reviewPendingBy: null }, { where: { ...MARKED, reviewPendingAt: { [Op.lt]: new Date(Date.now() - GIVE_UP_MS) } } });
  if (gaveUp[0]) logger.warn('Review lane: cases still marked after 30 minutes go back to the existing pipeline', { count: gaveUp[0] });
  if (!(await Case.count({ where: MARKED }))) return null;
  const run = await startRun(PIPELINE);
  const startedAt = new Date();
  let sequence = 0;
  for (const [name, service] of API_STEPS.filter(([job]) => REVIEW_JOBS.includes(job))) {
    await jobLock.touch(LOCK);
    await runStep(run.id, `review:${name}`, { run: () => service.run({ lane: 'review', first }) }, sequence, { lockName: null });
    sequence += 1;
  }
  await jobLock.touch(LOCK);
  // The same lock as the existing pipeline's sender: the two never send the same email at once.
  const moved = (await Case.findAll({ where: { source: 'API', updatedAt: { [Op.gte]: startedAt } }, attributes: ['id'] })).map((c) => c.id);
  await runStep(run.id, 'review:api-email-sender', { run: () => emailSender.run({ caseIds: moved }) }, sequence, { lockName: 'api-email-sender' });
  const failed = await PipelineRunStep.count({ where: { pipelineRunId: run.id, status: 'FAILED' } });
  await run.update({ status: failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', finishedAt: new Date() });
  return run;
}

/**
 * Starts the review lane, or asks the busy one to run once more. first: case ids to take first (a manual run).
 * Returns { started } at once; the rounds run in the background. Skipped while API cases are switched off.
 */
async function runReviewLane({ first = [] } = {}) {
  if (!(await getSettings()).apiCasesEnabled) return { started: false, skipped: 'source_disabled' };
  const before = await JobLock.findByPk(LOCK);
  const stale = Boolean(before?.running && before.startedAt && Date.now() - new Date(before.startedAt).getTime() > STALE_MS);
  if (!(await jobLock.acquire(LOCK, { staleMs: STALE_MS }))) {
    for (const id of first) queuedFirst.add(id);
    await jobLock.requestRerun(LOCK);
    return { started: false, queued: true };
  }
  if (stale) {
    logger.warn('Review lane: a stale lock was taken over', { lock: LOCK });
    await PipelineRun.update({ status: 'FAILED', finishedAt: new Date() }, { where: { pipeline: PIPELINE, status: 'RUNNING' } });
  }
  (async () => {
    let ids = first;
    try {
      do {
        // Taken before the round: ids asked for during it wait for the next round.
        const asked = [...queuedFirst];
        queuedFirst.clear();
        const run = await round([...new Set([...ids, ...asked])]);
        if (run) logger.info('Review lane round finished', { pipelineRunId: run.id, status: run.status });
        ids = [];
      } while (await jobLock.takeRerun(LOCK));
    } catch (error) {
      logger.error('Review lane crashed', { error: error.message, stack: error.stack });
    } finally {
      await jobLock.release(LOCK);
    }
    // A trigger between the last check and the release: run again.
    if (await jobLock.takeRerun(LOCK)) await runReviewLane();
  })().catch((error) => logger.error('Review lane crashed', { error: error.message }));
  return { started: true };
}

/** After a person's decision: start the lane, never failing the save that called it. */
function triggerReviewLane() {
  runReviewLane().catch((error) => logger.error('Review lane could not start', { error: error.message }));
}

module.exports = { LOCK, PIPELINE, REVIEW_JOBS, STALE_MS, GIVE_UP_MS, runReviewLane, triggerReviewLane, round };
