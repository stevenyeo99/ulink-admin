const { Case } = require('../../db/models');
const { checkCase } = require('../../modules/member-verification/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: runs the real IAS lookup + comparison logic for one case, but
 * never persists — nothing is written to Case or CaseEvent, and no EmailTask is queued.
 * Unlike document-checking's preview, this DOES make a real external call (there's no
 * meaningful way to "preview" an IAS lookup without actually calling IAS) — same spirit as
 * claim-recognition's preview, which calls the real LLM but skips persistence.
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
      outcome: outcome.outcome,
      result: outcome.result,
      iasResponse: outcome.iasResponse,
    });
  } catch (error) {
    logger.error('member-verification preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
