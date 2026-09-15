const { Case } = require('../../db/models');
const { checkClaimStatus } = require('../../modules/ias-claim-stp/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: makes a REAL IAS getClaimStatus call (same category as
 * member-verification's preview — real IAS call, zero persistence), but never calls
 * downloadFile and never writes to disk or the DB. Reports whether a ready report row was
 * found and its filename/filepath, nothing more.
 */
async function previewCase(req, res) {
  const { caseId } = req.params;

  try {
    const caseRecord = await Case.findByPk(caseId);
    if (!caseRecord) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }
    if (!caseRecord.claimNo) {
      return res.status(500).json({ error: { message: `Case ${caseId} has no claimNo (reached before ias-claim-creation succeeded)`, status: 500 } });
    }

    const status = await checkClaimStatus(caseRecord);
    res.json({ caseId: status.caseId, dryRun: true, ready: status.ready, filename: status.filename ?? null, filepath: status.filepath ?? null });
  } catch (error) {
    logger.error('ias-claim-stp preview failed', { caseId, error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { previewCase };
