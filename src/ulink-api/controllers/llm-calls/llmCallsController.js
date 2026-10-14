const { promptSummary } = require('../../modules/llm-calls/summary');
const { getSettings } = require('../../modules/settings/settings');

/**
 * GET /api/llm-calls/summary?days=7|30 — how each prompt version performs (SYSTEM_4 D2). Omit days for all time.
 * Super admin. Reads the settings first so "unsure" uses the saved AI confidence threshold.
 */
async function getPromptSummary(req, res) {
  const days = req.query.days === undefined ? null : parseInt(req.query.days, 10);
  if (days !== null && !(days > 0 && days <= 3650)) {
    return res.status(400).json({ error: { message: 'days must be a whole number of days, 1–3650 (or left out for all time)', status: 400 } });
  }
  await getSettings();
  res.json(await promptSummary({ days }));
}

module.exports = { getPromptSummary };
