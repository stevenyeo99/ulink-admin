const express = require('express');
const { resetCases } = require('../../controllers/dev/casesController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/cases/reset:
 *   post:
 *     tags: [dev]
 *     summary: Rewind one or more cases to an earlier pipeline stage for reprocessing
 *     description: >
 *       Sets Case.currentStatus back to an earlier stage for each case id given, and clears
 *       whatever fields that stage (and anything downstream of it) would have computed, so
 *       the next run of the corresponding job picks each case up again as if it hadn't been
 *       processed yet. Logs a CaseEvent per case (reasonCode MANUAL_RESET) so this is never
 *       a silent, untraceable edit to a case's history. Each case is processed independently
 *       — one not-found or invalid id doesn't fail the rest of the batch.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [caseIds, to]
 *             properties:
 *               caseIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               to: { type: string, enum: [READY_FOR_DOCUMENT_READING, RECOGNIZED] }
 *           example: { caseIds: ["9f7ae69f-uuid", "35f63068-uuid"], to: RECOGNIZED }
 *     responses:
 *       200:
 *         description: Per-case reset results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       ok: { type: boolean }
 *                       caseId: { type: string }
 *                       previousStatus: { type: string }
 *                       currentStatus: { type: string }
 *                       clearedFields: { type: array, items: { type: string } }
 *                       error: { type: string }
 *             example:
 *               results:
 *                 - ok: true
 *                   caseId: "9f7ae69f-uuid"
 *                   previousStatus: INCOMPLETE
 *                   currentStatus: RECOGNIZED
 *                   clearedFields: ["documentCheckResult"]
 *                 - ok: false
 *                   caseId: "bad-id"
 *                   error: "Case bad-id not found"
 *       400:
 *         description: Invalid or missing "to"/"caseIds"
 */
router.post('/reset', resetCases);

module.exports = router;
