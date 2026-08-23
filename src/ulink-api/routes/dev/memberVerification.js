const express = require('express');
const { previewCase } = require('../../controllers/dev/memberVerificationController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/member-verification/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview member verification for one case (real IAS call, nothing persisted)
 *     description: >
 *       Runs the same IAS lookup + comparison logic as the real member-verification job for
 *       a single case, but never writes to Case/CaseEvent and never queues an EmailTask.
 *       This DOES make a real call to the (staging) IAS GET_MEMBER_INFO_API — there's no
 *       meaningful dry run of an external lookup — it just skips persistence afterward.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The outcome that would have been persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 outcome: { type: string, enum: [MEMBER_VERIFIED, MEMBER_REVIEW_REQUIRED] }
 *                 result:
 *                   type: object
 *                   properties:
 *                     outcome: { type: string }
 *                     reasonCode: { type: string, nullable: true }
 *                     checks: { type: object }
 *                 iasResponse:
 *                   type: object
 *                   description: >
 *                     The raw IAS GET_MEMBER_INFO_API response as returned (what the real
 *                     job would persist verbatim to Case.iasMemberInfoResponse).
 *       404:
 *         description: Case not found
 *       500:
 *         description: Case has no extractedFields, missing NRC/accident_date, IAS call failed, or another error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
