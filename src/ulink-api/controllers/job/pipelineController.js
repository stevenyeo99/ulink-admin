const { PipelineRun, PipelineRunStep } = require('../../db/models');
const jobLock = require('../../jobs/jobLock');
const pipelineService = require('../../modules/pipeline/service');
const logger = require('../../utils/logger');

const BLOCK_NAME = 'pipeline';

/**
 * POST /api/jobs/pipeline/run — same fire-and-forget shape as every individual block's
 * /run handler (controllers/job/jobsController.js), wrapping the whole 7-step
 * orchestrator instead of one service. Guarded by its own 'pipeline' lock (jobLock is
 * keyed by an arbitrary block_name string, so this needs no schema change) so two
 * triggers can't produce two concurrent runs — each step inside still acquires its own
 * per-block lock too, see modules/pipeline/service.js.
 */
async function runPipeline(req, res) {
  const acquired = await jobLock.acquire(BLOCK_NAME);
  if (!acquired) {
    return res.json({ block: BLOCK_NAME, skipped: true, reason: 'already_running' });
  }

  const pipelineRun = await pipelineService.startRun();
  res.json({ block: BLOCK_NAME, started: true, runId: pipelineRun.id });

  pipelineService
    .executeSteps(pipelineRun)
    .then((run) => {
      logger.info('Pipeline run finished', { pipelineRunId: run.id, status: run.status });
    })
    .catch((error) => {
      // executeSteps already catches/persists step and run-level failures internally —
      // reaching here means something outside that (e.g. the final status update itself
      // failed), so there's nothing left to persist, just log it.
      logger.error('Pipeline run crashed', { pipelineRunId: pipelineRun.id, error: error.message, stack: error.stack });
    })
    .finally(() => jobLock.release(BLOCK_NAME));
}

/**
 * POST /api/jobs/pipeline/release — same idempotent shape as
 * controllers/job/jobsController.js's createReleaseHandler, plus: also marks the most
 * recent still-RUNNING PipelineRun as FAILED, so a manual release (the lock got stuck
 * some other way while the process itself is still up) doesn't leave an orphaned run
 * row behind. Automatic startup recovery for the common case (process restart) lives in
 * modules/pipeline/reconcile.js instead.
 */
async function releasePipeline(req, res) {
  const wasLocked = await jobLock.isRunning(BLOCK_NAME);
  await jobLock.release(BLOCK_NAME);

  const staleRun = await PipelineRun.findOne({ where: { status: 'RUNNING' }, order: [['startedAt', 'DESC']] });
  if (staleRun) {
    await PipelineRunStep.update(
      { status: 'FAILED', errorMessage: 'manually released', finishedAt: new Date() },
      { where: { pipelineRunId: staleRun.id, status: ['PENDING', 'RUNNING'] } }
    );
    await staleRun.update({ status: 'FAILED', finishedAt: new Date() });
  }

  res.json({ block: BLOCK_NAME, released: true, wasLocked });
}

/** GET /api/jobs/pipeline/runs — recent runs, newest first. */
async function listRuns(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const runs = await PipelineRun.findAll({ order: [['startedAt', 'DESC']], limit });
  res.json({ runs });
}

/** GET /api/jobs/pipeline/runs/:id — one run with its steps, in execution order. */
async function getRun(req, res) {
  const run = await PipelineRun.findByPk(req.params.id, {
    include: [{ model: PipelineRunStep }],
    order: [[PipelineRunStep, 'sequence', 'ASC']],
  });

  if (!run) {
    return res.status(404).json({ error: { message: `Pipeline run ${req.params.id} not found`, status: 404 } });
  }

  res.json({ run });
}

module.exports = { runPipeline, releasePipeline, listRuns, getRun };
