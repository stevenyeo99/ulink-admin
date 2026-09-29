const express = require('express');
const { requireRole } = require('../modules/auth/auth');
const { getCaseStatuses, getOverview, getReviewQueue, getApprovals, listCases, getCase, getAttachment, getDocument, overrideCase, resetCase, releaseMissingDocuments } = require('../controllers/cases/casesController');

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
 *       - name: source
 *         in: query
 *         schema: { type: string, enum: [EMAIL, API] }
 *         description: Only email cases or only API cases. Omit for both.
 *       - name: group
 *         in: query
 *         schema: { type: string, enum: [in_progress, waiting_customer, needs_review, done, failed] }
 *         description: Status group from GET /api/cases/statuses.
 *       - name: module
 *         in: query
 *         schema: { type: string }
 *         description: Module id from GET /api/cases/statuses (intake, recognition, member, documents, claim, stp).
 *       - name: q
 *         in: query
 *         schema: { type: string }
 *         description: Search claim no., TPA case number, case id or claimant name.
 *       - name: sort
 *         in: query
 *         schema: { type: string, enum: [updatedAt, createdAt, claimNo, status], default: updatedAt }
 *       - name: dir
 *         in: query
 *         schema: { type: string, enum: [asc, desc], default: desc }
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
 * /api/cases/statuses:
 *   get:
 *     tags: [cases]
 *     summary: Case status catalog — label, description, module and group for every status code
 *     description: >
 *       Status codes stay internal; the console shows the label (badge) and description (hover)
 *       from here, and groups / modules drive its filters and dashboard counts.
 *     responses:
 *       200:
 *         description: "{ statuses: { CODE: { module, group, label, description } }, modules: [...], groups: [...] }"
 */
router.get('/statuses', getCaseStatuses);

/**
 * @openapi
 * /api/cases/overview:
 *   get:
 *     tags: [cases]
 *     summary: Dashboard numbers — cases per group (who acts next) and new today
 *     parameters:
 *       - name: source
 *         in: query
 *         schema: { type: string, enum: [EMAIL, API] }
 *     responses:
 *       200:
 *         description: "{ total, newToday, groups: { groupId: n } }"
 */
router.get('/overview', getOverview);

/**
 * @openapi
 * /api/cases/review-queue:
 *   get:
 *     tags: [cases]
 *     summary: Review Queue — cases a person should look at, oldest first, with reason and what to check
 *     description: >
 *       Needs-review statuses, IAS rejections, and open cases whose AI assessment has a point the
 *       team should check (modules/review-queue/queue.js). Finished cases and cases only waiting on
 *       the customer's missing documents are not included.
 *     parameters:
 *       - name: source
 *         in: query
 *         schema: { type: string, enum: [EMAIL, API] }
 *     responses:
 *       200:
 *         description: "{ items: [{ id, source, currentStatus, claimNo, tpaCaseNumber, reason, check, reasons, pointCount, … }], counts: { reason: n }, total }"
 */
router.get('/review-queue', getReviewQueue);

/**
 * @openapi
 * /api/cases/approvals:
 *   get:
 *     tags: [cases]
 *     summary: Approvals — non-STP claims waiting for JD2 in IAS, oldest first, with the AI's review points
 *     parameters:
 *       - name: source
 *         in: query
 *         schema: { type: string, enum: [EMAIL, API] }
 *     responses:
 *       200:
 *         description: "{ items: [{ id, source, currentStatus, claimNo, tpaCaseNumber, updatedAt, reviewPoints: [string] }], total }"
 */
router.get('/approvals', getApprovals);

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
 * /api/cases/{caseId}/documents/{documentId}:
 *   get:
 *     tags: [cases]
 *     summary: View one case document (an API case's console image)
 *     description: >
 *       Case-level documents (ulink_case_documents) — today, the console images
 *       api-material-download stored for an API case. Same rules as the attachment endpoint:
 *       caseId is required and checked against the document's owning case.
 *     parameters:
 *       - name: caseId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: documentId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The raw file bytes
 *       404:
 *         description: Document not found, or doesn't belong to this case
 */
router.get('/:caseId/documents/:documentId', getDocument);

/**
 * @openapi
 * /api/cases/{id}/override:
 *   post:
 *     tags: [cases]
 *     summary: Human-in-the-loop bypass — advance a stuck case past its failing check
 *     description: >
 *       Only valid from INCOMPLETE (→ MEMBER_VERIFIED) or MEMBER_REVIEW_REQUIRED
 *       (→ READY_FOR_DOCUMENT_CHECKING) — a pure Case.currentStatus write, so the next scheduled job for
 *       the new status picks the case up normally. Super admin only; requires a reason, and
 *       records the logged-in user. Logs one CaseEvent (reasonCode MANUAL_OVERRIDE) capturing
 *       who, the reason and a snapshot of what was waived.
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Case advanced
 *       400:
 *         description: Missing reason, or the case isn't at a reviewable status
 *       404:
 *         description: Case not found
 */
router.post('/:id/override', requireRole('super_admin'), overrideCase);

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
router.post('/:id/reset', requireRole('super_admin'), resetCase);

/**
 * @openapi
 * /api/cases/{id}/release-missing-documents:
 *   post:
 *     tags: [cases]
 *     summary: Send a held missing-documents email to the customer (after a person checked the documents)
 *     description: >
 *       Only for a case held by the switch "hold the missing-documents email when the AI is unsure"
 *       (DOCUMENTS_REVIEW / API_DOCUMENTS_REVIEW). Email case → INCOMPLETE; API case → API_INCOMPLETE
 *       (then the suspended revision in IAS). Super admin. If the documents are fine, use /override instead.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Email queued, case moved on }
 *       400: { description: Case is not held }
 *       409: { description: The case changed meanwhile }
 */
router.post('/:id/release-missing-documents', requireRole('super_admin'), releaseMissingDocuments);

module.exports = router;
