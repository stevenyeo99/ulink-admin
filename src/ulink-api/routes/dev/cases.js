const express = require('express');
const { resetCase } = require('../../controllers/dev/casesController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/cases/{caseId}/reset:
 *   post:
 *     tags: [dev]
 *     summary: Rewind a case to an earlier pipeline stage for reprocessing
 *     description: >
 *       Sets Case.currentStatus back to an earlier stage and clears whatever fields that
 *       stage (and anything downstream of it) would have computed, so the next run of the
 *       corresponding job picks the case up again as if it hadn't been processed yet.
 *       Logs a CaseEvent (reasonCode MANUAL_RESET) so this is never a silent, untraceable
 *       edit to the case's history. For replaying an already-processed real case after a
 *       bugfix, instead of waiting for new test data.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to]
 *             properties:
 *               to: { type: string, enum: [READY_FOR_DOCUMENT_READING, RECOGNIZED] }
 *           example: { to: RECOGNIZED }
 *     responses:
 *       200:
 *         description: Case reset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 previousStatus: { type: string }
 *                 currentStatus: { type: string }
 *                 clearedFields: { type: array, items: { type: string } }
 *             example:
 *               caseId: "9f7ae69f-uuid"
 *               previousStatus: INCOMPLETE
 *               currentStatus: RECOGNIZED
 *               clearedFields: ["documentCheckResult"]
 *       400:
 *         description: Invalid or missing "to" status
 *       404:
 *         description: Case not found
 */
router.post('/:caseId/reset', resetCase);

module.exports = router;
