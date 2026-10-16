const express = require('express');
const { getPromptSummary, getFeedbackReport } = require('../controllers/llm-calls/llmCallsController');

const router = express.Router();

/**
 * @openapi
 * /api/llm-calls/summary:
 *   get:
 *     tags: [llm-calls]
 *     summary: How each prompt version performs — calls by status, time, tokens, confidence, unsure share (SYSTEM_4 D2)
 *     description: >
 *       One row per prompt name and version from the AI call log (ulink_llm_calls); the prompts on this server with
 *       no calls yet are listed too, marked current. Super admin.
 *     parameters:
 *       - { name: days, in: query, required: false, schema: { type: integer, minimum: 1 }, description: Only the last N days (left out = all time) }
 *     responses:
 *       200: { description: "{ threshold, prompts: [...] }" }
 *       400: { description: Bad days }
 */
router.get('/summary', getPromptSummary);

/**
 * @openapi
 * /api/llm-calls/feedback-report:
 *   get:
 *     tags: [llm-calls]
 *     summary: Every correction, confirmation and override of the AI — one row each (SYSTEM_4 E4-14, F2)
 *     description: >
 *       From ulink_ai_feedback and the MANUAL_OVERRIDE case-history entries, newest first. The console filters by item
 *       and type and downloads CSV. Super admin.
 *     parameters:
 *       - { name: from, in: query, required: false, schema: { type: string, format: date-time }, description: From this time (included) }
 *       - { name: to, in: query, required: false, schema: { type: string, format: date-time }, description: Up to this time (excluded) }
 *     responses:
 *       200: { description: "{ truncated, rows: [{ at, caseId, claimNo, tpaCaseNumber, source, type, item, aiFinding, aiConfidence, decision, comment, by, trusted }] }" }
 *       400: { description: Bad date }
 */
router.get('/feedback-report', getFeedbackReport);

module.exports = router;
