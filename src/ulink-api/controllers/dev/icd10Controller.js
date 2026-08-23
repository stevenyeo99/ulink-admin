const { findCandidates } = require('../../modules/icd10/lookup');
const logger = require('../../utils/logger');

/**
 * Developer-only: nearest-neighbor ICD-10 candidates for arbitrary free text, for manually
 * sanity-checking retrieval quality (e.g. against a real case's detail_of_illness_injury)
 * before this ever feeds a real claim payload. Requires ulink_icd10_diagnoses to already be
 * populated (scripts/ingestIcd10Diagnoses.js).
 */
async function lookup(req, res) {
  const { text, topK } = req.body || {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: { message: '"text" must be a non-empty string', status: 400 } });
  }

  try {
    const candidates = await findCandidates(text, { topK: topK || 5 });
    res.json({ text, candidates });
  } catch (error) {
    logger.error('icd10 lookup failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
}

module.exports = { lookup };
