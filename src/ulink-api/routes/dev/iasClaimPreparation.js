const express = require('express');
const { previewCase } = require('../../controllers/dev/iasClaimPreparationController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/ias-claim-preparation/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview the CL_CLAIM_API payload for one case (real LLM calls, nothing persisted)
 *     description: >
 *       Runs the same diagnosis-code pick (modules/ias-claim-preparation/diagnosisPicker.js,
 *       via the ICD-10 vector RAG, once per case), one benefit-type/head pick per invoice
 *       voucher (modules/ias-claim-preparation/benefitPicker.js, against the member's own
 *       plan — using each voucher's own voucher_type as the strongest signal), and payload
 *       construction (modules/ias-claim-preparation/payloadBuilder.js, one Items[] line per
 *       voucher) as the real job, but never writes to Case/CaseEvent. Makes real LLM
 *       calls — there's no meaningful dry run of an LLM decision without actually asking it.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The diagnosis pick, the per-line benefit picks, and the payload that would have been persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 diagnosis: { type: object, nullable: true }
 *                 lines:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       subtotal: { type: number, nullable: true }
 *                       benefit: { type: object, nullable: true }
 *                 payload: { type: object }
 *       404:
 *         description: Case not found
 *       500:
 *         description: Case missing extractedFields/iasMemberInfoResponse, LLM call failed, or another error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
