const { Case } = require('../../db/models');
const { checkCase } = require('../../modules/document-checking/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: runs the same checklist logic as the real job for one case,
 * but never persists — nothing is written to Case or CaseEvent. Stage 1 (EVALUATORS +
 * deterministic flags) is instant, no LLM. Stage 2 (the 6 judgment calls,
 * items 13-18) only runs if stage 1 already has zero issues — same cost-gating as the
 * real job — so this can take a few seconds on a clean case, and is instant on one that
 * already fails a deterministic check.
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
      issues: outcome.result.issues,
      passed: outcome.result.passed,
      flags: outcome.result.flags,
    });
  } catch (error) {
    logger.error('document-checking preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
