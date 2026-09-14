const express = require('express');
const { previewCase, previewFiles, decideRouteFiles, extractFieldsFiles } = require('../../controllers/dev/claimRecognitionController');
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

/**
 * @openapi
 * /api/dev/claim-recognition/preview-files:
 *   post:
 *     tags: [dev]
 *     summary: Preview claim recognition for arbitrary local PDF files (dry run, no Case needed)
 *     description: >
 *       Same rasterize -> transcribe -> synthesize -> ajv-validate pipeline as
 *       /{caseId}/preview, but the input is a list of local PDF file paths instead of a
 *       Case's stored attachments — no Case is created or read, nothing is written
 *       anywhere (the only DB access is the existing read of ulink_claim_routes). For
 *       reviewing what extraction would produce against a file that isn't attached to any
 *       Case yet. Makes real LLM calls — not free/instant.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pdfPaths]
 *             properties:
 *               pdfPaths:
 *                 type: array
 *                 items: { type: string }
 *                 description: Absolute or relative (to the API process's cwd) local file paths.
 *           example:
 *             pdfPaths: ["/tmp/sample-claim-form.pdf", "/tmp/sample-medical-record.pdf"]
 *     responses:
 *       200:
 *         description: The recognition outcome that would have been produced from these files
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pdfPaths: { type: array, items: { type: string } }
 *                 dryRun: { type: boolean }
 *                 outcome: { type: string, enum: [RECOGNIZED, NOT_RECOGNIZED, MANUAL_REVIEW] }
 *                 recognizedType: { type: string, nullable: true }
 *                 reasonCode: { type: string, nullable: true }
 *                 message: { type: string, nullable: true }
 *                 extractedFields: { type: object, nullable: true }
 *       400:
 *         description: pdfPaths missing or not a non-empty array of strings
 *       500:
 *         description: Pipeline error (file not found, LLM/rasterize error) or no enabled claim routes configured
 */
router.post('/preview-files', previewFiles);

/**
 * @openapi
 * /api/dev/claim-recognition/decide-route:
 *   post:
 *     tags: [dev]
 *     summary: Task 1 only — route decision against local PDF files (dry run)
 *     description: >
 *       Transcribes the given PDFs and runs ONLY the route-decision call
 *       (prompts/route-decision.md) — no extraction schema involved, so this is fast
 *       regardless of how large a route's own schema is. Nothing written anywhere.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pdfPaths]
 *             properties:
 *               pdfPaths: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: The route decision
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pdfPaths: { type: array, items: { type: string } }
 *                 dryRun: { type: boolean }
 *                 reason: { type: string }
 *                 route: { type: string }
 *                 confidence: { type: number }
 *       400:
 *         description: pdfPaths missing or not a non-empty array of strings
 *       500:
 *         description: Pipeline error or no enabled claim routes configured
 */
router.post('/decide-route', decideRouteFiles);

/**
 * @openapi
 * /api/dev/claim-recognition/extract-fields:
 *   post:
 *     tags: [dev]
 *     summary: Task 2 only — field extraction against local PDF files for one specific route (dry run)
 *     description: >
 *       Transcribes the given PDFs and runs ONLY the field-extraction call
 *       (prompts/extract-fields.md) against the given routeKey's own extractionSchema.
 *       Decoupled from route decision on purpose — extraction can be reviewed in isolation
 *       against a known route even before Task 1's decision is trusted. Nothing written
 *       anywhere.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pdfPaths, routeKey]
 *             properties:
 *               pdfPaths: { type: array, items: { type: string } }
 *               routeKey: { type: string, description: "A routeKey from ulink_claim_routes, e.g. ayas_member_claim" }
 *     responses:
 *       200:
 *         description: The extracted fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pdfPaths: { type: array, items: { type: string } }
 *                 routeKey: { type: string }
 *                 dryRun: { type: boolean }
 *                 extractedFields: { type: object, nullable: true }
 *       400:
 *         description: pdfPaths or routeKey missing/invalid
 *       404:
 *         description: No enabled route with that routeKey
 *       500:
 *         description: Pipeline error
 */
router.post('/extract-fields', extractFieldsFiles);

module.exports = router;
