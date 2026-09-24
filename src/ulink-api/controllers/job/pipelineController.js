const { PipelineRun, PipelineRunStep } = require('../../db/models');
const jobLock = require('../../jobs/jobLock');
const pipelineService = require('../../modules/pipeline/service');
const logger = require('../../utils/logger');

/**
 * Handlers for one orchestrator: 'EMAIL' (/api/jobs/pipeline, lock 'pipeline') or 'API'
 * (/api/jobs/api-pipeline, lock 'api-pipeline'). Each pipeline has its own lock, so the two can
 * run side by side; a job they share still takes its own per-block lock inside runStep. Every
 * handler only sees its own pipeline's runs, so the console's Email and API tabs never mix.
 */
function createPipelineController(pipeline, lockName) {
  /**
   * POST .../run — same fire-and-forget shape as every individual block's /run handler
   * (controllers/job/jobsController.js), wrapping the whole orchestrator instead of one
   * service. Guarded by the pipeline's own lock (jobLock is keyed by an arbitrary block_name
   * string) so two triggers can't produce two concurrent runs of the same pipeline.
   */
  async function runPipeline(req, res) {
    const acquired = await jobLock.acquire(lockName);
    if (!acquired) {
      return res.json({ block: lockName, skipped: true, reason: 'already_running' });
    }

    const pipelineRun = await pipelineService.startRun(pipeline);
    res.json({ block: lockName, started: true, runId: pipelineRun.id });

    pipelineService
      .executeSteps(pipelineRun)
      .then((run) => {
        logger.info('Pipeline run finished', { pipeline, pipelineRunId: run.id, status: run.status });
      })
      .catch((error) => {
        // executeSteps already catches/persists step and run-level failures internally —
        // reaching here means something outside that (e.g. the final status update itself
        // failed), so there's nothing left to persist, just log it.
        logger.error('Pipeline run crashed', { pipeline, pipelineRunId: pipelineRun.id, error: error.message, stack: error.stack });
      })
      .finally(() => jobLock.release(lockName));
  }

  /**
   * POST .../release — same idempotent shape as controllers/job/jobsController.js's
   * createReleaseHandler, plus: also marks this pipeline's most recent still-RUNNING run as
   * FAILED, so a manual release doesn't leave an orphaned run row behind. Automatic startup
   * recovery for the common case (process restart) lives in modules/pipeline/reconcile.js.
   */
  async function releasePipeline(req, res) {
    const wasLocked = await jobLock.isRunning(lockName);
    await jobLock.release(lockName);

    const staleRun = await PipelineRun.findOne({ where: { pipeline, status: 'RUNNING' }, order: [['startedAt', 'DESC']] });
    if (staleRun) {
      await PipelineRunStep.update(
        { status: 'FAILED', errorMessage: 'manually released', finishedAt: new Date() },
        { where: { pipelineRunId: staleRun.id, status: ['PENDING', 'RUNNING'] } }
      );
      await staleRun.update({ status: 'FAILED', finishedAt: new Date() });
    }

    res.json({ block: lockName, released: true, wasLocked });
  }

  /** GET .../runs — this pipeline's recent runs, newest first. */
  async function listRuns(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const runs = await PipelineRun.findAll({ where: { pipeline }, order: [['startedAt', 'DESC']], limit });
    res.json({ runs });
  }

  /** GET .../runs/:id — one of this pipeline's runs with its steps, in execution order. */
  async function getRun(req, res) {
    const run = await PipelineRun.findOne({
      where: { id: req.params.id, pipeline },
      include: [{ model: PipelineRunStep }],
      order: [[PipelineRunStep, 'sequence', 'ASC']],
    });

    if (!run) {
      return res.status(404).json({ error: { message: `Pipeline run ${req.params.id} not found`, status: 404 } });
    }

    res.json({ run });
  }

  return { runPipeline, releasePipeline, listRuns, getRun };
}

module.exports = {
  ...createPipelineController('EMAIL', 'pipeline'),
  apiPipeline: createPipelineController('API', 'api-pipeline'),
};
