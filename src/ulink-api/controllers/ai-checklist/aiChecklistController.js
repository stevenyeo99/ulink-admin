const { catalog } = require('../../modules/ai-checklist/catalog');
const { switchStates, switchable, setSwitch } = require('../../modules/ai-checklist/switches');

/**
 * GET /api/ai-checklist — every member and document check, what it does and what a reviewer can do (SYSTEM_5 A), with
 * its switch (phase B): enabled, switchable, and the last change (who, when, why). Super admin.
 */
async function getAiChecklist(req, res) {
  const { sections, checks } = catalog();
  const states = await switchStates();
  res.json({
    sections,
    checks: checks.map((check) => {
      const row = states.get(check.code);
      // A row for a check that can no longer be switched (now locked) does not count: the check runs.
      return { ...check, enabled: !(row?.enabled === false && switchable(check)), switchable: switchable(check), lastChange: row ? { enabled: row.enabled, reason: row.reason, by: row.changedBy, at: row.createdAt } : null };
    }),
  });
}

/** PUT /api/ai-checklist/:code — { enabled, reason } (SYSTEM_5 phase B). Super admin. Applies to cases checked from now on. */
async function putSwitch(req, res) {
  const by = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  const result = await setSwitch(req.params.code, req.body?.enabled, req.body?.reason, by);
  if (result.error) return res.status(400).json({ error: { message: result.error, status: 400 } });
  return res.json({ code: result.code, enabled: result.enabled, reason: result.reason, by: result.changedBy, at: result.createdAt });
}

module.exports = { getAiChecklist, putSwitch };
