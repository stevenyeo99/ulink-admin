const express = require('express');
const { previewCase } = require('../../controllers/dev/emailSenderController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/email-sender/{caseId}/preview:
 *   post:
 *     tags: [dev]
 *     summary: Preview the rendered email for a case's pending task (dry run, nothing sent)
 *     description: >
 *       Renders the most recent PENDING ulink_email_tasks row for this case via the same
 *       templates the real email-sender job uses, but never calls SMTP and never writes
 *       anything. Useful for checking wording without SMTP credentials configured.
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The subject/body that would have been sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 caseId: { type: string }
 *                 dryRun: { type: boolean }
 *                 taskId: { type: string }
 *                 taskType: { type: string, enum: [MISSING_DOCUMENTS, DOCUMENT_COMPLETE_ACK, CLAIM_CREATED_NOTIFICATION, MEMBER_VERIFY_ISSUE] }
 *                 subject: { type: string, nullable: true }
 *                 bodyText: { type: string }
 *       404:
 *         description: No PENDING task for this case
 *       500:
 *         description: Rendering error
 */
router.post('/:caseId/preview', previewCase);

module.exports = router;
