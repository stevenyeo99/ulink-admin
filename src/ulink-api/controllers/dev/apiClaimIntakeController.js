const { resolveDateRange, fetchApiClaims } = require('../../modules/api-claim-intake/service');
const logger = require('../../utils/logger');

/**
 * Developer-only preview: makes a REAL IAS get_claim_api call and returns the claims as-is.
 * Zero persistence — nothing is written to the DB. Omitted dates default to today (Myanmar).
 */
async function previewClaims(req, res) {
  const range = resolveDateRange({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });
  if (range.error) {
    return res.status(400).json({ error: { message: range.error, status: 400 } });
  }

  try {
    res.json({ dryRun: true, ...(await fetchApiClaims(range)) });
  } catch (error) {
    logger.error('api-claim-intake preview failed', { ...range, error: error.message, stack: error.stack });
    res.status(502).json({ error: { message: error.message, status: 502 } });
  }
}

module.exports = { previewClaims };
