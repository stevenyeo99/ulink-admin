const express = require('express');
const { previewCase } = require('../../controllers/dev/iasClaimStpController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/ias-claim-stp/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview ias-claim-stp for one case (real IAS call, zero persistence, no download)
 *     description: >
 *       Calls the real IAS claim-status API for this case's claimNo and reports whether a
 *       settlement-report row exists yet (SCMA_OID_CL_STATUS=CL_STATUS_FC with a non-empty
 *       FILENAME/PATH) — same category as member-verification's preview (real IAS call,
 *       zero persistence). Unlike the real job, never calls downloadFile and never writes
 *       to CSR_UPLOAD_ROOT or the DB.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Whether a report row was found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 ready: { type: boolean }
 *                 filename: { type: string, nullable: true }
 *                 filepath: { type: string, nullable: true }
 *             example:
 *               caseId: "3f2a1b7e-uuid"
 *               dryRun: true
 *               ready: true
 *               filename: "CSR_CC_02_2511230003.pdf"
 *               filepath: "/AYAS/Claims/2026/01-16/000716-000/"
 *       404:
 *         description: Case not found
 *       500:
 *         description: Case has no claimNo yet, or another error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
