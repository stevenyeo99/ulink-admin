const { Op } = require('sequelize');
const { Case, CaseEvent, ApiCaseStep, JobLock, PipelineRun } = require('../../db/models');
const { CASE_STATUSES } = require('../../modules/case-status/catalog');
const logger = require('../../utils/logger');

const reviewLane = () => require('../../modules/review-lane/lane'); // at call time: the lane loads every job module

// The Reviewed page (SYSTEM_5 review lane, docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md 4.6): the cases a person decided
// that the review lane is checking again. A row is highlighted after 15 minutes; after 30 the lane gives the case back
// to the existing pipeline (lane.js GIVE_UP_MS), so it leaves this list.
const HIGHLIGHT_MINUTES = 15;
const MAX_RUN = 20;
// The person's actions that mark a case (their case events), newest first: the decision the row shows.
const DECISIONS = ['MANUAL_CORRECTION', 'MANUAL_RECHECK', 'ASK_CUSTOMER', 'INFORMATION_REQUESTED', 'MANUAL_OVERRIDE', 'MISSING_DOCUMENTS_RELEASED', 'MANUAL_BENEFIT', 'MANUAL_PREPARATION', 'DOCUMENTS_UPLOADED'];

/** GET /api/cases/reviewed?source=API — the decided cases, oldest decision first, with their last lane round. */
async function getReviewed(req, res) {
  const source = ['EMAIL', 'API'].includes(req.query.source) ? req.query.source : null;
  const cases = await Case.findAll({
    where: { reviewPendingAt: { [Op.ne]: null }, ...(source ? { source } : {}) },
    attributes: ['id', 'source', 'currentStatus', 'claimNo', 'tpaCaseNumber', 'reviewPendingAt', 'reviewPendingBy', 'extractedFields'],
    order: [['reviewPendingAt', 'ASC']],
  });
  const ids = cases.map((c) => c.id);
  const since = cases.length ? new Date(Math.min(...cases.map((c) => new Date(c.reviewPendingAt).getTime())) - 5000) : new Date();
  const { REVIEW_JOBS, PIPELINE, LANES, STALE_MS } = reviewLane();
  const [events, steps, readings, lastRound, apiLock, emailLock] = await Promise.all([
    ids.length ? CaseEvent.findAll({ where: { caseId: ids, reasonCode: DECISIONS, createdAt: { [Op.gte]: since } }, order: [['createdAt', 'DESC']] }) : [],
    ids.length ? ApiCaseStep.findAll({ where: { caseId: ids, job: REVIEW_JOBS, updatedAt: { [Op.gte]: since } }, order: [['updatedAt', 'DESC']] }) : [],
    // The claimant of an API case is on its latest reading (a correction adds a new one).
    ids.length ? ApiCaseStep.findAll({ where: { caseId: ids, job: 'api-claim-recognition', status: 'DONE' }, attributes: ['caseId', 'output', 'createdAt'], order: [['createdAt', 'DESC']] }) : [],
    PipelineRun.findOne({ where: { pipeline: PIPELINE }, order: [['startedAt', 'DESC']] }),
    JobLock.findByPk(LANES.API.lock),
    JobLock.findByPk(LANES.EMAIL.lock),
  ]);
  // A lock left by a stopped API is not a running round (the next trigger takes it over).
  const live = (lock) => Boolean(lock?.running && lock.startedAt && Date.now() - new Date(lock.startedAt).getTime() <= STALE_MS);
  const runningIn = { API: live(apiLock), EMAIL: live(emailLock) };
  const running = runningIn.API;

  const now = Date.now();
  const items = cases.map((c) => {
    const at = new Date(c.reviewPendingAt).getTime();
    const decision = events.find((e) => e.caseId === c.id && new Date(e.createdAt).getTime() >= at - 5000);
    const step = steps.find((s) => s.caseId === c.id && new Date(s.updatedAt).getTime() >= at);
    const waitingMinutes = Math.floor((now - at) / 60000);
    return {
      id: c.id, source: c.source, currentStatus: c.currentStatus, claimNo: c.claimNo, tpaCaseNumber: c.tpaCaseNumber,
      claimant: (c.source === 'API' ? readings.find((r) => r.caseId === c.id)?.output?.extractedFields : c.extractedFields)?.claimant?.claimant_name ?? null,
      statusLabel: CASE_STATUSES[c.currentStatus]?.label ?? c.currentStatus,
      decidedAt: c.reviewPendingAt, decidedBy: c.reviewPendingBy, decision: decision?.message ?? null,
      waitingMinutes, highlighted: waitingMinutes >= HIGHLIGHT_MINUTES,
      // Email jobs keep no steps of their own: the round state only.
      lastRound: runningIn[c.source] ? { state: 'running' }
        : !step ? { state: 'waiting' }
          : step.status === 'FAILED' ? { state: 'failed', job: step.job, error: step.error }
            : { state: 'waiting', job: step.job },
    };
  });
  res.json({
    items, total: items.length, highlighted: items.filter((i) => i.highlighted).length,
    lastRoundAt: lastRound?.startedAt ?? null, lastRoundRunning: running, highlightMinutes: HIGHLIGHT_MINUTES,
  });
}

/** POST /api/cases/reviewed/run — { caseIds } (1 to 20 decided API cases): run the review lane now, these first. Super admin. */
async function runReviewed(req, res) {
  const ids = req.body?.caseIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_RUN || ids.some((id) => typeof id !== 'string')) {
    return res.status(400).json({ error: { message: `Choose 1 to ${MAX_RUN} cases.`, status: 400 } });
  }
  const unique = [...new Set(ids)];
  const cases = await Case.findAll({ where: { id: unique }, attributes: ['id', 'source', 'currentStatus', 'reviewPendingAt', 'claimNo'] });
  const notMarked = unique.filter((id) => !cases.some((c) => c.id === id && c.reviewPendingAt));
  if (notMarked.length) {
    return res.status(400).json({ error: { message: `Only cases being checked again after a decision can run here. Not one of them: ${notMarked.length} case(s).`, status: 400, notMarked } });
  }
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  // Each flow's lane, its cases first.
  const results = {};
  for (const source of ['API', 'EMAIL']) {
    const mine = cases.filter((c) => c.source === source).map((c) => c.id);
    if (mine.length) results[source] = await reviewLane().runReviewLane({ source, first: mine });
  }
  const ran = cases.filter((c) => results[c.source]?.started || results[c.source]?.queued);
  const result = { started: Object.values(results).some((r) => r.started), queued: Object.values(results).some((r) => r.queued), skipped: Object.values(results).every((r) => r.skipped) ? 'source_disabled' : undefined };
  // Logged only when the lane runs them (now, or first in the next round).
  if (ran.length) {
    await CaseEvent.bulkCreate(ran.map((c) => ({
      caseId: c.id, blockName: 'case-review', prevStatus: c.currentStatus, newStatus: c.currentStatus, reasonCode: 'REVIEW_RUN_AGAIN',
      message: `Run again by ${operator} (review lane).`,
    })));
  }
  logger.info('Review lane run by a person', { caseIds: unique, username: req.user.username, ...result });
  res.json(result);
}

module.exports = { getReviewed, runReviewed, HIGHLIGHT_MINUTES, MAX_RUN };
