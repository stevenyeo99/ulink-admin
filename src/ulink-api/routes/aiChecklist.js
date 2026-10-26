const express = require('express');
const { getAiChecklist, putSwitch } = require('../controllers/ai-checklist/aiChecklistController');

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
 *       200: { description: "{ sections: [{ key, title, intro }], checks: [{ code, section, group, question, label, does, effect, usesAi, locked, ifFails, reviewerCan, enabled, switchable, lastChange }] }" }
 */
router.get('/', getAiChecklist);

/**
 * @openapi
 * /api/ai-checklist/{code}:
 *   put:
 *     tags: [ai-checklist]
 *     summary: Switch a check off or on, with a reason (SYSTEM_5 phase B)
 *     description: >
 *       A switched-off check is skipped (its AI comparison is not asked) and shows Turned off on the case; while a check
 *       that can stop a case is off, no claim goes STP. Locked checks, information lines and checks off in the code
 *       cannot be switched. Applies to cases checked from now on. Super admin.
 *     parameters:
 *       - { name: code, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [enabled, reason], properties: { enabled: { type: boolean }, reason: { type: string, minLength: 3 } } }
 *     responses:
 *       200: { description: "{ code, enabled, reason, by, at }" }
 *       400: { description: No such check, locked or not switchable, no reason, or already in that state }
 */
router.put('/:code', putSwitch);

module.exports = router;
