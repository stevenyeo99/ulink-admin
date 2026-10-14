const express = require('express');
const { getPromptSummary } = require('../controllers/llm-calls/llmCallsController');

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

module.exports = router;
