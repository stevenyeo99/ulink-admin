const { Case } = require('../../db/models');
const { getEnabledRoutes } = require('../../modules/claim-recognition/routeCatalog');
const { recognizeCase } = require('../../modules/claim-recognition/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: runs the same recognition logic (rasterize, transcribe,
 * synthesize, validate) as the real job for one case, but never calls persistOutcome —
 * nothing is written to Case or CaseEvent. For manually checking what the pipeline
 * would decide before trusting it against real data.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const routes = await getEnabledRoutes();
    if (routes.length === 0) {
      return res.status(500).json({ error: { message: 'No enabled claim routes configured (ulink_claim_routes)', status: 500 } });
    }

    const outcome = await recognizeCase(caseRecord, routes);
    res.json({
      caseId: outcome.caseId,
      dryRun: true,
      skipped: outcome.skipped || false,
      reason: outcome.reason || null,
      outcome: outcome.outcome || null,
      recognizedType: outcome.recognizedType || null,
      reasonCode: outcome.reasonCode || null,
      message: outcome.message || null,
      extractedFields: outcome.extractedFields || null,
    });
  } catch (error) {
    logger.error('claim-recognition preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
