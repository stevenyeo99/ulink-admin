const { Op, literal } = require('sequelize');
const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');
const { leavesLane } = require('../review-lane/marker');
const { forCase } = require('../llm-calls/log');

/**
 * Runs one API case job over every case waiting at its input status. A job is a plain object:
 *
 *   { name, inputStatus, inputs: ['earlier-job', ...], optionalInputs: [...], batchLimit,
 *     (inputStatus: one or several; optionalInputs: jobs that may not have run for the case yet)
 *     process({ caseRecord, input }) -> { output, nextStatus, message } | { wait: true, output } }
 *
 * `input` is { [earlierJob]: its latest DONE output } — a job only ever receives what the jobs it
 * names produced, so each job's input and output are explicit and stored (ulink_api_case_steps).
 * This runner owns everything around process(): picking cases (source='API' only), building the
 * input, and saving the outcome.
 *
 * - DONE: the step row, the status move and the case event are written in one transaction, and
 *   only if the case is still at the status it was picked at (a concurrent change rolls it back).
 * - WAITING (nothing to do yet) / FAILED (technical error): the case stays where it is and is
 *   retried next run. Repeating the same outcome updates the latest row instead of adding one
 *   every 30 minutes, so the history shows changes, not polling.
 */

async function loadInputs(caseId, jobs, optionalJobs = []) {
  const input = {};
  for (const job of [...jobs, ...optionalJobs]) {
    const step = await ApiCaseStep.findOne({ where: { caseId, job, status: 'DONE' }, order: [['createdAt', 'DESC']] });
    if (step) input[job] = step.output;
    else if (jobs.includes(job)) throw new Error(`No output from ${job} for this case`);
  }
  return input;
}

async function recordRetryable(caseId, job, status, fields) {
  const latest = await ApiCaseStep.findOne({ where: { caseId, job }, order: [['createdAt', 'DESC']] });
  if (latest && latest.status === status) return latest.update(fields);
  return ApiCaseStep.create({ caseId, job, status, ...fields });
}

async function recordDone(caseRecord, job, { input, output, nextStatus, message, startedAt }) {
  const prevStatus = caseRecord.currentStatus;
  await sequelize.transaction(async (transaction) => {
    const [moved] = await Case.update(
      // A case leaving the review lane (its next stop, wait or end) is no longer marked (REVIEW_LANE_PRD 4.1.3).
      { currentStatus: nextStatus, ...(leavesLane(nextStatus) ? { reviewPendingAt: null, reviewPendingBy: null } : {}) },
      { where: { id: caseRecord.id, source: 'API', currentStatus: prevStatus }, transaction }
    );
    if (moved !== 1) throw new Error(`Case left ${prevStatus} while ${job.name} was running`);
    await ApiCaseStep.create(
      { caseId: caseRecord.id, job: job.name, status: 'DONE', input, output, startedAt, finishedAt: new Date() },
      { transaction }
    );
    await CaseEvent.create(
      { caseId: caseRecord.id, blockName: job.name, prevStatus, newStatus: nextStatus, message },
      { transaction }
    );
  });
}

// lane: 'new' (the existing pipeline) takes only unmarked cases; 'review' (the review lane, REVIEW_LANE_PRD 4.3) only
// cases a person decided — first: those a person asked to run now, then the oldest decision.
async function runApiJob(job, { lane = 'new', first = [] } = {}) {
  const review = lane === 'review';
  const ids = first.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const cases = await Case.findAll({
    where: { source: 'API', currentStatus: job.inputStatus, reviewPendingAt: review ? { [Op.ne]: null } : null },
    limit: job.batchLimit,
    // Oldest untouched first, so cases re-checked every run (a waiting status among several
    // inputStatus values) can't starve new ones.
    order: review
      ? [...(ids.length ? [[literal(`"Case"."id" IN (${ids.map((id) => `'${id}'`).join(',')})`), 'DESC']] : []), ['reviewPendingAt', 'ASC']]
      : [['updatedAt', 'ASC']],
  });

  const summary = { processed: 0, waiting: 0, errors: [] };
  for (const caseRecord of cases) {
    const startedAt = new Date();
    let input = null;
    try {
      input = await loadInputs(caseRecord.id, job.inputs, job.optionalInputs);
      // AI calls made for this case are logged against it and this job (modules/llm-calls).
      const result = await forCase(caseRecord.id, job.name, () => job.process({ caseRecord, input }));
      if (result.wait) {
        await recordRetryable(caseRecord.id, job.name, 'WAITING', { input, output: result.output, error: null, startedAt, finishedAt: new Date() });
        summary.waiting += 1;
        continue;
      }
      await recordDone(caseRecord, job, { input, startedAt, ...result });
      summary.processed += 1;
    } catch (error) {
      await recordRetryable(caseRecord.id, job.name, 'FAILED', { input, output: null, error: error.message, startedAt, finishedAt: new Date() })
        .catch(() => {}); // the error below is what matters; don't let bookkeeping hide it
      summary.errors.push({ caseId: caseRecord.id, error: error.message });
    }
  }
  return summary;
}

module.exports = { runApiJob, loadInputs };
