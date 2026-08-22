const express = require('express');
const { previewCase } = require('../../controllers/dev/documentCheckingController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/document-checking/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview document checking for one case (dry run, nothing persisted)
 *     description: >
 *       Runs the same checklist evaluators as the real document-checking job for a single
 *       case, but never writes to Case or CaseEvent. Pure code over Case.extractedFields —
 *       no LLM call, instant, unlike the claim-recognition preview.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The checklist outcome that would have been persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 outcome: { type: string, enum: [DOCUMENT_CHECKED, INCOMPLETE] }
 *                 issues: { type: array, items: { type: string } }
 *                 passed: { type: boolean }
 *             example:
 *               caseId: "3f2a1b7e-uuid"
 *               dryRun: true
 *               outcome: INCOMPLETE
 *               issues: ["Missing detailed breakdown for pharmacy charges in the voucher(s)"]
 *               passed: false
 *       404:
 *         description: Case not found
 *       500:
 *         description: Case has no extractedFields (reached RECOGNIZED without extraction data), or another error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
