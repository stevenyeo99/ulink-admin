const { Case } = require('../../db/models');
const { checkCase } = require('../../modules/ias-claim-preparation/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: runs the real diagnosis/benefit LLM picks and builds the real
 * claim payload for one case, but never persists — nothing is written to Case/CaseEvent.
 * Makes real LLM calls (same as member-verification's preview making a real IAS call) —
 * there's no meaningful dry run of "would the LLM pick a good diagnosis code" without
 * actually asking it.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const outcome = await checkCase(caseRecord);
    res.json({
      caseId: outcome.caseId,
      dryRun: true,
      diagnosis: outcome.diagnosis,
      lines: outcome.lines,
      payload: outcome.payload,
    });
  } catch (error) {
    logger.error('ias-claim-preparation preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
