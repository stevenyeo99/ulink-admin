const express = require('express');
const { previewCase } = require('../../controllers/dev/consoleUploadController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/console-upload/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview console-upload for one case (dry run, nothing persisted, no disk writes)
 *     description: >
 *       Computes the destination folder, barcode, and gathered-attachments list the real
 *       console-upload job would use for this case, without writing any file to
 *       CONSOLE_UPLOAD_ROOT or touching Case/CaseEvent. Works for any case with
 *       extractedFields — doesn't require currentStatus=MEMBER_VERIFIED, so it can be used
 *       to sanity-check the naming/barcode before a case actually reaches that status.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The upload plan that would have been executed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 folder: { type: string }
 *                 barcode: { type: string }
 *                 files:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       originalFilename: { type: string }
 *                       destFilename: { type: string }
 *             example:
 *               caseId: "3f2a1b7e-uuid"
 *               dryRun: true
 *               folder: "2026/09/15/15092026ZayYarTun-AYAS-3f2a1b7e-uuid"
 *               barcode: "VSQ9F1XXXX"
 *               files:
 *                 - { originalFilename: "voucher.pdf", destFilename: "0-voucher.pdf" }
 *       404:
 *         description: Case not found
 *       500:
 *         description: Error computing the plan
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
