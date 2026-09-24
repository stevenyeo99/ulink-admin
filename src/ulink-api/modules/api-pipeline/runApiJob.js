const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');

/**
 * Runs one API case job over every case waiting at its input status. A job is a plain object:
 *
 *   { name, inputStatus, inputs: ['earlier-job', ...], batchLimit,     (inputStatus: one or several)
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

async function loadInputs(caseId, jobs) {
  const input = {};
  for (const job of jobs) {
    const step = await ApiCaseStep.findOne({ where: { caseId, job, status: 'DONE' }, order: [['createdAt', 'DESC']] });
    if (!step) throw new Error(`No output from ${job} for this case`);
    input[job] = step.output;
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
      { currentStatus: nextStatus },
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

async function runApiJob(job) {
  const cases = await Case.findAll({
    where: { source: 'API', currentStatus: job.inputStatus },
    limit: job.batchLimit,
    // Oldest untouched first, so cases re-checked every run (a waiting status among several
    // inputStatus values) can't starve new ones.
    order: [['updatedAt', 'ASC']],
  });

  const summary = { processed: 0, waiting: 0, errors: [] };
  for (const caseRecord of cases) {
    const startedAt = new Date();
    let input = null;
    try {
      input = await loadInputs(caseRecord.id, job.inputs);
      const result = await job.process({ caseRecord, input });
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
