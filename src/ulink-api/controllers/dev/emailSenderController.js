const { EmailTask } = require('../../db/models');
const { render } = require('../../modules/email-sender/templates');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: renders the most recent PENDING email task for a case, but
 * never sends and never persists anything — no SMTP call, no task/CaseEvent update. Lets
 * the wording be checked without real SMTP credentials configured.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const task = await EmailTask.findOne({
      where: { caseId, status: 'PENDING' },
      order: [['createdAt', 'DESC']],
    });

    if (!task) {
      return res.status(404).json({ error: { message: `No PENDING EmailTask for case ${caseId}`, status: 404 } });
    }

    const rendered = render(task.taskType, task.payload);
    res.json({ caseId, dryRun: true, taskId: task.id, taskType: task.taskType, ...rendered });
  } catch (error) {
    logger.error('email-sender preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
