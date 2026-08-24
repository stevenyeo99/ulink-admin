const { PipelineRun, PipelineRunStep } = require('../../db/models');
const logger = require('../../utils/logger');

/**
 * Called once at process startup (bin/www, right after server.listen). A PipelineRun
 * still RUNNING at boot time is stale by definition — the only process that could have
 * been running it just started fresh, so whatever process owned it is gone (crash,
 * kill, deploy). Mirrors why ulink_job_locks needs its own manual /release endpoint,
 * except this runs automatically instead of waiting for an operator.
 */
async function reconcileStaleRuns() {
  const staleRuns = await PipelineRun.findAll({ where: { status: 'RUNNING' } });

  for (const pipelineRun of staleRuns) {
    await PipelineRunStep.update(
      { status: 'FAILED', errorMessage: 'interrupted by server restart', finishedAt: new Date() },
      { where: { pipelineRunId: pipelineRun.id, status: ['PENDING', 'RUNNING'] } }
    );
    await pipelineRun.update({ status: 'FAILED', finishedAt: new Date() });
    logger.info('Reconciled stale pipeline run at startup', { pipelineRunId: pipelineRun.id });
  }
}

module.exports = { reconcileStaleRuns };
