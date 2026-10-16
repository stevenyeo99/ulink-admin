const { promptSummary } = require('../../modules/llm-calls/summary');
const { getSettings } = require('../../modules/settings/settings');
const { feedbackReport } = require('../../modules/ai-feedback/report');

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

/**
 * GET /api/llm-calls/feedback-report?from=<ISO time>&to=<ISO time> — every correction, "✓ Right" and override
 * (SYSTEM_4 E4-14, F2). from included, to excluded; either left out = no limit on that side. The console sends the
 * user's local midnights, so a day means the user's day. Super admin.
 */
async function getFeedbackReport(req, res, next) {
  const parse = (v) => (v ? new Date(v) : null);
  const from = parse(req.query.from);
  const to = parse(req.query.to);
  if ((from && isNaN(from)) || (to && isNaN(to))) {
    return res.status(400).json({ error: { message: 'from and to must be dates (ISO 8601) or left out', status: 400 } });
  }
  try {
    return res.json(await feedbackReport({ from, to }));
  } catch (error) {
    return next(error); // Express 4 does not pass a rejected promise to the error handler by itself
  }
}

module.exports = { getPromptSummary, getFeedbackReport };
