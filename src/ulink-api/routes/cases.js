const express = require('express');
const { listCases, getCase, getAttachment, overrideCase, resetCase } = require('../controllers/cases/casesController');

const router = express.Router();

/**
 * @openapi
 * /api/cases:
 *   get:
 *     tags: [cases]
 *     summary: List cases — all statuses by default, newest-updated first
 *     description: >
 *       A general "did the system process this correctly" browser, not just the manual-review
 *       queue — every case at any status unless narrowed with ?status=. Lightweight fields
 *       only; use GET /api/cases/:id for full extractedFields/documentCheckResult/
 *       memberVerifyResult/email thread.
 *     parameters:
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *         description: Comma-separated Case.currentStatus values. Omit for all statuses.
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 100, maximum: 200 }
 *       - name: offset
 *         in: query
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Matching cases
 *       400:
 *         description: Unknown status filter
 */
router.get('/', listCases);

/**
 * @openapi
 * /api/cases/{id}:
 *   get:
 *     tags: [cases]
 *     summary: Full case detail — extraction/check results, audit timeline, email thread
 *     description: >
 *       The Case row (extractedFields, documentCheckResult, memberVerifyResult,
 *       iasClaimPayload, iasClaimResult, claimNo), its CaseEvent timeline, and its
 *       EmailThread(s) → EmailMessage(s) → EmailAttachment(s) — everything needed to show the
 *       original submission and every job's output for one case in a single call.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The case, its events (oldest first), and its email thread
 *       404:
 *         description: Case not found
 */
router.get('/:id', getCase);

/**
 * @openapi
 * /api/cases/{caseId}/attachments/{attachmentId}:
 *   get:
 *     tags: [cases]
 *     summary: Download/view one attachment's actual file bytes
 *     description: >
 *       The only endpoint in this API that streams a file — every other attachment consumer
 *       reads storage internally (claim-recognition's vision LLM call), never over HTTP.
 *       No auth (Day 1, trusted host, same posture as the rest of this API) — attachments can
 *       be real medical records/bank details, so caseId is required and checked against the
 *       attachment's actual owning case. Content-Disposition is inline for PDF/image so it
 *       opens directly in a browser tab; attachment (forces download) otherwise.
 *     parameters:
 *       - name: caseId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: attachmentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The raw file bytes
 *       404:
 *         description: Attachment not found, or doesn't belong to this case
 */
router.get('/:caseId/attachments/:attachmentId', getAttachment);

/**
 * @openapi
 * /api/cases/{id}/override:
 *   post:
 *     tags: [cases]
 *     summary: Human-in-the-loop bypass — advance a stuck case past its failing check
 *     description: >
 *       Only valid from INCOMPLETE (→ MEMBER_VERIFIED) or MEMBER_REVIEW_REQUIRED
 *       (→ READY_FOR_DOCUMENT_CHECKING) — a pure Case.currentStatus write, so the next scheduled job for
 *       the new status picks the case up normally. Requires both reason and operatorName;
 *       no auth exists yet (Day 1, trusted host, same as every /api/jobs/* endpoint) so
 *       operatorName is plain free text, not an authenticated identity. Logs one CaseEvent
 *       (reasonCode MANUAL_OVERRIDE) capturing the reason and a snapshot of what was waived.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason, operatorName]
 *             properties:
 *               reason: { type: string }
 *               operatorName: { type: string }
 *     responses:
 *       200:
 *         description: Case advanced
 *       400:
 *         description: Missing reason/operatorName, or the case isn't at a reviewable status
 *       404:
 *         description: Case not found
 */
router.post('/:id/override', overrideCase);

/**
 * @openapi
 * /api/cases/{id}/reset:
 *   post:
 *     tags: [cases]
 *     summary: Rewind a case back to READY_FOR_DOCUMENT_READING for reprocessing
 *     description: >
 *       Sets Case.currentStatus back to READY_FOR_DOCUMENT_READING and clears
 *       recognizedType/extractedFields/documentCheckResult and everything downstream
 *       (memberVerifyResult/iasMemberInfoResponse/iasClaimPayload/claimNo/iasClaimResult), so
 *       the next pipeline run reprocesses the case from claim-recognition onward. Logs a
 *       CaseEvent (reasonCode MANUAL_RESET). Refuses (409) if the case already has a real
 *       IAS claimNo — resetting would erase the only local record of an already-created,
 *       non-idempotent external claim. Single-case equivalent of POST /api/dev/cases/reset
 *       (to: READY_FOR_DOCUMENT_READING), reachable from the console UI.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Case reset
 *       404:
 *         description: Case not found
 *       409:
 *         description: Case already has a real IAS claim number — refusing to reset
 */
router.post('/:id/reset', resetCase);

module.exports = router;
