const { Case, CaseEvent } = require('../../db/models');
const logger = require('../../utils/logger');

const BLOCK_NAME = 'dev-reset';

/**
 * Which fields get cleared when resetting TO a given status — everything that status's
 * own stage (and anything downstream of it) would have computed, so no stale data from
 * a prior run sits around implying work that hasn't actually happened yet.
 */
const RESET_FIELDS = {
  READY_FOR_DOCUMENT_READING: ['recognizedType', 'extractedFields', 'documentCheckResult'],
  RECOGNIZED: ['documentCheckResult'],
};

const VALID_STATUSES = Object.keys(RESET_FIELDS);

/**
 * Developer-only: rewinds a case to an earlier pipeline stage so it gets picked up and
 * reprocessed by that stage's job again — e.g. after a bugfix, replay an already-processed
 * real case instead of waiting for new test data. Logs a CaseEvent so a manual reset is
 * never silent/untraceable in the case's history.
 */
async function resetCase(req, res) {
  const { caseId } = req.params;
  const { to } = req.body || {};

  if (!VALID_STATUSES.includes(to)) {
    return res.status(400).json({
      error: { message: `"to" must be one of: ${VALID_STATUSES.join(', ')}`, status: 400 },
    });
  }

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const clearedFields = RESET_FIELDS[to];
    const previousStatus = caseRecord.currentStatus;
    const updates = { currentStatus: to };
    for (const field of clearedFields) updates[field] = null;

    await Case.update(updates, { where: { id: caseId } });
    await CaseEvent.create({
      caseId,
      blockName: BLOCK_NAME,
      prevStatus: previousStatus,
      newStatus: to,
      reasonCode: 'MANUAL_RESET',
      message: `Reset via dev tool, cleared: ${clearedFields.join(', ')}`,
    });

    res.json({ caseId, previousStatus, currentStatus: to, clearedFields });
  } catch (error) {
    logger.error('case reset failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { resetCase, VALID_STATUSES };
