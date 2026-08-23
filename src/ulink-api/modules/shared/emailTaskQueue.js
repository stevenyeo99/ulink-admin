const { EmailTask } = require('../../db/models');

/**
 * Shared by every producer of ulink_email_tasks (document-checking, member-verification):
 * skip creating a new task if the most recent one of this taskType for this case already
 * has the same dedupeKey — a re-check that finds the exact same problem shouldn't queue a
 * duplicate email. Only an actual change (dedupeKey differs, or no task exists yet) queues
 * a fresh one.
 */
async function queueDedupedTask(transaction, { caseId, taskType, dedupeKey = null, payload = {} }) {
  const lastTask = await EmailTask.findOne({
    where: { caseId, taskType },
    order: [['createdAt', 'DESC']],
    transaction,
  });

  if (lastTask && lastTask.dedupeKey === dedupeKey) return;

  await EmailTask.create({ caseId, taskType, dedupeKey, payload }, { transaction });
}

module.exports = { queueDedupedTask };
