const { catalog } = require('../../modules/ai-checklist/catalog');

/** GET /api/ai-checklist — every member and document check, what it does and what a reviewer can do (SYSTEM_5 A). Super admin. */
function getAiChecklist(req, res) {
  res.json(catalog());
}

module.exports = { getAiChecklist };
