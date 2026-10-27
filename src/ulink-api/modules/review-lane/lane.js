const { Op } = require('sequelize');
const { Case, JobLock, PipelineRun, PipelineRunStep } = require('../../db/models');
const jobLock = require('../../jobs/jobLock');
const { getSettings } = require('../settings/settings');
const logger = require('../../utils/logger');

// The review lanes (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md 4.3 to 4.5), one for each flow: the flow's existing jobs,
// in the same order, on the cases a person decided only (marker.js). Each lane has its own pipeline lock, so it never
// waits for the existing pipeline and the existing pipeline never waits for it. One round at a time: a trigger while a
// round is busy sets the "run again" flag, and the busy run does one more round. Started by a person's save (trigger),
// the retry cron and a manual run.

// A lock older than this is a run that stopped without releasing it (an API restart): the next trigger takes it over.
const STALE_MS = 15 * 60 * 1000;
// A case still marked after this is no longer the lane's (a job that keeps failing or waiting): its marker is cleared,
// and the existing pipeline takes it on its next run, as before the lane (REVIEW_LANE_PRD risk 2).
const GIVE_UP_MS = 30 * 60 * 1000;

// The jobs a decided case can need until its next stop, wait or end — not intake, the reading of new mail, console
// watch, the download, the barcode or the settlement report: the case leaves the lane before those (marker.js). The
// emails: one sender step for every case that moved in the round, under the existing sender's lock (never twice at once).
const LANES = {
  API: {
    lock: 'api-review-pipeline',
    pipeline: 'API_REVIEW',
    sourceSetting: 'apiCasesEnabled',
    jobs: ['api-claim-recognition', 'api-member-verification', 'api-document-checking', 'api-console-upload', 'api-claim-preparation', 'api-claim-revision'],
    steps: () => require('../pipeline/service').API_STEPS,
    sender: { name: 'api-email-sender', run: (caseIds) => require('../api-email-sender/service').run({ caseIds }) },
  },
  EMAIL: {
    lock: 'review-pipeline',
    pipeline: 'EMAIL_REVIEW',
    sourceSetting: 'emailCasesEnabled',
    jobs: ['member-verification', 'document-checking', 'console-upload', 'ias-claim-preparation', 'ias-claim-creation'],
    steps: () => require('../pipeline/service').STEPS,
    sender: { name: 'email-sender', run: (caseIds) => require('../email-sender/service').run({ caseIds }) },
  },
};
const lane = (source) => LANES[source] || LANES.API;

// The API lane's constants under their earlier names (the Reviewed page, the health line).
const { lock: LOCK, pipeline: PIPELINE, jobs: REVIEW_JOBS } = LANES.API;

const markedIn = (source) => ({ source, reviewPendingAt: { [Op.ne]: null } });
// Cases a person asked to run first while a round was busy: the next round takes them first.
// ponytail: kept in memory — one API process; move to the lock row if the API ever runs as several processes.
const queuedFirst = { API: new Set(), EMAIL: new Set() };

// One round: each job over the marked cases at its input status, then the emails of every case of the flow that moved
// during the round (a case marked or leaving the lane meanwhile too). No round, and no run in the history, with nothing
// marked.
async function round(source, first) {
  const { runStep, startRun } = require('../pipeline/service'); // here, not at the top: it loads every job module
  const config = lane(source);
  const marked = markedIn(source);
  const { CASE_STATUSES } = require('../case-status/catalog');
  const { leavesLane } = require('./marker');
  const left = Object.keys(CASE_STATUSES).filter(leavesLane);
  await Case.update({ reviewPendingAt: null, reviewPendingBy: null }, { where: { ...marked, currentStatus: left } });
  const gaveUp = await Case.update({ reviewPendingAt: null, reviewPendingBy: null }, { where: { ...marked, reviewPendingAt: { [Op.lt]: new Date(Date.now() - GIVE_UP_MS) } } });
  if (gaveUp[0]) logger.warn('Review lane: cases still marked after 30 minutes go back to the existing pipeline', { source, count: gaveUp[0] });
  if (!(await Case.count({ where: marked }))) return null;
  const run = await startRun(config.pipeline);
  const startedAt = new Date();
  let sequence = 0;
  for (const [name, service] of config.steps().filter(([job]) => config.jobs.includes(job))) {
    await jobLock.touch(config.lock);
    await runStep(run.id, `review:${name}`, { run: () => service.run({ lane: 'review', first }) }, sequence, { lockName: null });
    sequence += 1;
  }
  await jobLock.touch(config.lock);
  const moved = (await Case.findAll({ where: { source, updatedAt: { [Op.gte]: startedAt } }, attributes: ['id'] })).map((c) => c.id);
  await runStep(run.id, `review:${config.sender.name}`, { run: () => config.sender.run(moved) }, sequence, { lockName: config.sender.name });
  const failed = await PipelineRunStep.count({ where: { pipelineRunId: run.id, status: 'FAILED' } });
  await run.update({ status: failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', finishedAt: new Date() });
  return run;
}

/**
 * Starts the review lane of a flow ('API' or 'EMAIL'), or asks the busy one to run once more. first: case ids to take
 * first (a manual run). Returns { started } at once; the rounds run in the background. Skipped while the flow's cases
 * are switched off.
 */
async function runReviewLane({ source = 'API', first = [] } = {}) {
  const config = lane(source);
  if (!(await getSettings())[config.sourceSetting]) return { started: false, skipped: 'source_disabled' };
  const before = await JobLock.findByPk(config.lock);
  const stale = Boolean(before?.running && before.startedAt && Date.now() - new Date(before.startedAt).getTime() > STALE_MS);
  if (!(await jobLock.acquire(config.lock, { staleMs: STALE_MS }))) {
    for (const id of first) queuedFirst[source].add(id);
    await jobLock.requestRerun(config.lock);
    return { started: false, queued: true };
  }
  if (stale) {
    logger.warn('Review lane: a stale lock was taken over', { lock: config.lock });
    await PipelineRun.update({ status: 'FAILED', finishedAt: new Date() }, { where: { pipeline: config.pipeline, status: 'RUNNING' } });
  }
  (async () => {
    let ids = first;
    try {
      do {
        // Taken before the round: ids asked for during it wait for the next round.
        const asked = [...queuedFirst[source]];
        queuedFirst[source].clear();
        const run = await round(source, [...new Set([...ids, ...asked])]);
        if (run) logger.info('Review lane round finished', { source, pipelineRunId: run.id, status: run.status });
        ids = [];
      } while (await jobLock.takeRerun(config.lock));
    } catch (error) {
      logger.error('Review lane crashed', { source, error: error.message, stack: error.stack });
    } finally {
      await jobLock.release(config.lock);
    }
    // A trigger between the last check and the release: run again.
    if (await jobLock.takeRerun(config.lock)) await runReviewLane({ source });
  })().catch((error) => logger.error('Review lane crashed', { source, error: error.message }));
  return { started: true };
}

/** After a person's decision on a case of this flow: start its lane, never failing the save that called it. */
function triggerReviewLane(source = 'API') {
  runReviewLane({ source }).catch((error) => logger.error('Review lane could not start', { source, error: error.message }));
}

module.exports = { LANES, LOCK, PIPELINE, REVIEW_JOBS, STALE_MS, GIVE_UP_MS, runReviewLane, triggerReviewLane, round };
