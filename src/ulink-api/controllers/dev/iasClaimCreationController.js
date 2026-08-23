const { Case } = require('../../db/models');
const { checkCase, persistOutcome } = require('../../modules/ias-claim-creation/service');
const logger = require('../../utils/logger');

/**
 * Developer-only — but UNLIKE every other "preview" endpoint in this codebase, this one is
 * NOT a dry run and DOES persist. There is no confirmed "validate without creating" mode on
 * IAS's side (payloadBuilder's isValidation is "N" — a real submission), so calling this
 * genuinely creates a real claim in IAS if it succeeds. Deliberately calls persistOutcome
 * too (not just checkCase, unlike the other dev previews): NOT recording a real, successful
 * external claim creation would be actively harmful — an orphaned real claim IAS thinks
 * exists, a wasted claim number, and the real job later retrying and hitting "already
 * exists" for a case we never actually recorded as created. Persisting the real outcome is
 * the safer choice specifically because the action itself is already irreversible.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }

    const outcome = await checkCase(caseRecord);
    await persistOutcome(caseRecord, outcome);
    res.json({ caseId: outcome.caseId, dryRun: false, response: outcome.response });
  } catch (error) {
    logger.error('ias-claim-creation preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
