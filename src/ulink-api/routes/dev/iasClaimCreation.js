const express = require('express');
const { previewCase } = require('../../controllers/dev/iasClaimCreationController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/ias-claim-creation/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: >
 *       Submit a real claim to IAS for one case — WARNING, unlike every other dev preview
 *       endpoint in this API, this is NOT a dry run and DOES persist.
 *     description: >
 *       Calls the real IAS CL_CLAIM_API with Case.iasClaimPayload — there is no confirmed
 *       "validate without creating" mode, so a success here creates a real claim in IAS.
 *       Deliberately persists the result (Case.currentStatus/claimNo/iasClaimResult, and
 *       queues the CLAIM_CREATED_NOTIFICATION email on success) exactly like the real job
 *       would, because NOT recording a real successful external claim creation would be
 *       actively harmful (an orphaned real claim, a later real run hitting "already exists"
 *       for a case never recorded as created). Only call this against a case you intend to
 *       actually submit.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The real IAS response (success or business rejection) — already persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean, description: "Always false for this endpoint." }
 *                 response: { type: object }
 *       404:
 *         description: Case not found
 *       500:
 *         description: Case missing iasClaimPayload, IAS call failed technically, or another error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
