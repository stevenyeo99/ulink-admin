const express = require('express');
const { previewCase } = require('../../controllers/dev/claimRecognitionController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/claim-recognition/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview claim recognition for one case (dry run, nothing persisted)
 *     description: >
 *       Runs the same rasterize -> transcribe -> synthesize -> ajv-validate pipeline as
 *       the real claim-recognition job for a single case, but never writes to Case or
 *       CaseEvent. For manually checking what the pipeline would decide (route,
 *       confidence, extracted_fields) before trusting it against real data. Makes real
 *       LLM calls — not free/instant, but has no side effects on the database.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The recognition outcome that would have been persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 skipped: { type: boolean, description: "true if the case had no attachments" }
 *                 outcome: { type: string, enum: [RECOGNIZED, NOT_RECOGNIZED, MANUAL_REVIEW] }
 *                 recognizedType: { type: string, nullable: true }
 *                 reasonCode: { type: string, nullable: true }
 *                 message: { type: string, nullable: true }
 *                 extractedFields: { type: object, nullable: true }
 *             example:
 *               caseId: "3f2a1b7e-uuid"
 *               dryRun: true
 *               skipped: false
 *               outcome: RECOGNIZED
 *               recognizedType: ayas_member_claim
 *               reasonCode: null
 *               message: "AYA SOMPO claim notification with reimbursement benefit type"
 *               extractedFields: { policy: {}, claimant: {}, claim: {}, medical: {}, bank: {}, documents_present: {}, medical_record: {}, invoice: {} }
 *       404:
 *         description: Case not found
 *       500:
 *         description: Pipeline error (LLM/rasterize/etc.) or no enabled claim routes configured
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
