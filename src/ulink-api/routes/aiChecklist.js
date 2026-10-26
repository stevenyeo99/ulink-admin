const express = require('express');
const { getAiChecklist } = require('../controllers/ai-checklist/aiChecklistController');

const router = express.Router();

/**
 * @openapi
 * /api/ai-checklist:
 *   get:
 *     tags: [ai-checklist]
 *     summary: Every member and document check the system runs, in plain words (SYSTEM_5 phase A)
 *     description: >
 *       From modules/ai-checklist/catalog.js. reviewerCan comes from the correction panel's own rules. Super admin.
 *     responses:
 *       200: { description: "{ sections: [{ key, title, intro }], checks: [{ code, section, group, question, label, does, effect, usesAi, locked, ifFails, reviewerCan }] }" }
 */
router.get('/', getAiChecklist);

module.exports = router;
