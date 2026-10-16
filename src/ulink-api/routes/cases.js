const express = require('express');
const { requireRole } = require('../modules/auth/auth');
const { getCaseStatuses, getOverview, getReviewQueue, getNextCase, getApprovals, listCases, getCase, getTimeline, getLlmCalls, getAttachment, getDocument, overrideCase, resetCase, releaseMissingDocuments, uploadCaseDocuments } = require('../controllers/cases/casesController');
const { createCorrection, createConfirmation, trustCorrection } = require('../controllers/cases/correctionsController');
const { claim, release } = require('../controllers/cases/claimController');
const { requestInformation } = require('../controllers/cases/requestsController');
const { requireNotHeldByOther } = require('../modules/case-claim/claim');

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
 *         description: Search claim no., TPA case number, case id, claimant name or NRC / passport (Email and API cases).
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
 * /api/cases/next:
 *   get:
 *     tags: [cases]
 *     summary: The case to review next — oldest in the review queue, not held by someone else (SYSTEM_4 E4-20)
 *     parameters:
 *       - { name: after, in: query, schema: { type: string, format: uuid }, description: 'The case just reviewed (skipped)' }
 *       - { name: source, in: query, schema: { type: string, enum: [EMAIL, API] } }
 *     responses:
 *       200: { description: '{ id } — null when the queue is empty' }
 */
router.get('/next', getNextCase);

/**
 * @openapi
 * /api/cases/approvals:
 *   get:
 *     tags: [cases]
 *     summary: Approvals — non-STP claims waiting for JD3 in IAS, oldest first, with the AI's review points
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
 * /api/cases/{id}/llm-calls:
 *   get:
 *     tags: [cases]
 *     summary: The AI calls made for one case, oldest first (SYSTEM_4 E4-26)
 *     description: >
 *       From ulink_llm_calls — job, prompt name and version, model, status (ok / error / timeout / too_long),
 *       duration, tokens, the AI's answer and its confidence. Shown in the case page's technical details.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ calls: [...] }" }
 */

router.get('/:id/llm-calls', getLlmCalls);

/**
 * @openapi
 * /api/cases/{id}/timeline:
 *   get:
 *     tags: [cases]
 *     summary: The case's single timeline — who changed what and why (SYSTEM_4 E4-24)
 *     description: >
 *       Newest first: case history (status moves, overrides, corrections, claims, uploads, IAS steps, emails), AI calls
 *       grouped per job run (no raw answers), "✓ Right" confirmations and trusted marks. Each entry: at, kind
 *       (people / ai / email / ias / system), source, what, why.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: '{ entries }' }
 *       404: { description: Case not found }
 */
router.get('/:id/timeline', getTimeline);

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
router.post('/:id/override', requireRole('super_admin'), requireNotHeldByOther, overrideCase);

/**
 * @openapi
 * /api/cases/{id}/corrections:
 *   post:
 *     tags: [cases]
 *     summary: Correct one value the AI read, or one check's verdict (SYSTEM_4 E4-12)
 *     description: >
 *       Allowed while a member or document finding holds the case (the override statuses). Stores the correction
 *       (ulink_ai_feedback: AI value and confidence, corrected value, reason, which step was wrong, page, who),
 *       writes it into the case's fields, and checks the case again with it — from the member check (RECOGNIZED /
 *       API_RECOGNIZED) for a value the member check compares with IAS, else from the document check. Missing documents
 *       found after a correction wait for the person (no automatic customer email). Super admin. Logs a CaseEvent
 *       (MANUAL_CORRECTION). No IAS write.
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
 *             required: [kind, item, reason, wrongStep]
 *             properties:
 *               kind: { type: string, enum: [value, verdict] }
 *               item: { type: string, description: 'A field path (e.g. claimant.claimant_nrc_passport, invoices.items.0.date) or a checklist code' }
 *               value: { description: 'kind=value: the correct value (amount, YYYY-MM-DD date or text)' }
 *               passed: { type: boolean, description: 'kind=verdict: the correct verdict' }
 *               reason: { type: string }
 *               wrongStep: { type: string, enum: [reading, mapping, check] }
 *     responses:
 *       200: { description: Corrected; the case is checked again }
 *       400: { description: Not correctable now, or the value / verdict / reason is missing or invalid }
 *       404: { description: Case not found }
 *       409: { description: The case moved while the person was reviewing it }
 */
router.post('/:id/corrections', requireRole('super_admin'), requireNotHeldByOther, createCorrection);

/**
 * @openapi
 * /api/cases/{id}/corrections/{feedbackId}/trust:
 *   post:
 *     tags: [cases]
 *     summary: Mark a correction trusted, so it may teach the AI later (SYSTEM_4 E4-15)
 *     description: Super admin; never the person who made the correction.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *       - { name: feedbackId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Trusted }
 *       403: { description: The person who made the correction, or not a super admin }
 *       404: { description: Correction not found }
 */
/**
 * @openapi
 * /api/cases/{id}/confirmations:
 *   post:
 *     tags: [cases]
 *     summary: "✓ Right: the AI's value or verdict was checked and is right (SYSTEM_4 E4-20)"
 *     description: >
 *       Learning data only (ulink_ai_feedback kind confirm: value, AI confidence, page, who); the case does not change.
 *       Once per person per item and value. Super admin; refused (409) while someone else is reviewing the case.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, item]
 *             properties:
 *               kind: { type: string, enum: [value, verdict] }
 *               item: { type: string }
 *               reason: { type: string, description: 'Optional; default "Checked against the document"' }
 *     responses:
 *       200: { description: Confirmed (or already confirmed) }
 *       400: { description: Not an item of this case, or nothing read to confirm }
 *       404: { description: Case not found }
 */
router.post('/:id/confirmations', requireRole('super_admin'), requireNotHeldByOther, createConfirmation);

// Not claim-guarded on purpose: the trusted mark comes from a second person, usually while the corrector holds the case.
router.post('/:id/corrections/:feedbackId/trust', requireRole('super_admin'), trustCorrection);

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
 *       (to: READY_FOR_DOCUMENT_READING), reachable from the console UI. A comment (why) is
 *       required and kept in the case history (SYSTEM_4 E4-11).
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
 *             required: [comment]
 *             properties:
 *               comment: { type: string, minLength: 3, description: Why the case is reset }
 *     responses:
 *       200:
 *         description: Case reset
 *       400:
 *         description: No comment
 *       404:
 *         description: Case not found
 *       409:
 *         description: Case already has a real IAS claim number — refusing to reset
 */
router.post('/:id/reset', requireRole('super_admin'), requireNotHeldByOther, resetCase);

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
 *       A comment (what the person checked) is required and kept in the case history (SYSTEM_4 E4-11).
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [comment]
 *             properties:
 *               comment: { type: string, minLength: 3, description: What the person checked }
 *     responses:
 *       200: { description: Email queued, case moved on }
 *       400: { description: Case is not held, or no comment }
 *       409: { description: The case changed meanwhile }
 */
router.post('/:id/release-missing-documents', requireRole('super_admin'), requireNotHeldByOther, releaseMissingDocuments);

/**
 * @openapi
 * /api/cases/{id}/request-information:
 *   post:
 *     tags: [cases]
 *     summary: A reviewer's own checklist lines on this case — ask for what the predefined checklist misses (SYSTEM_4 E4-28)
 *     description: >
 *       Super admin. From DOCUMENTS_REVIEW / DOCUMENTS_UNSURE (→ INCOMPLETE) and API_DOCUMENTS_REVIEW /
 *       API_DOCUMENTS_UNSURE (→ API_INCOMPLETE, IAS revision with suspense). The lines replace the open ones; the team is
 *       emailed to contact the customer about them (never in the customer's email). While a line is open, a passed
 *       document check stops for a person; confirming there marks the lines done.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lines, comment]
 *             properties:
 *               lines: { type: array, minItems: 1, maxItems: 10, items: { type: string, maxLength: 300 } }
 *               comment: { type: string, minLength: 3, description: Why this is needed }
 *     responses:
 *       200: { description: Lines stored, case moved to its waiting-for-documents status }
 *       400: { description: No lines, too many / too long, no comment, or not at a documents review status }
 *       409: { description: The case changed meanwhile, or has no document check }
 */
router.post('/:id/request-information', requireRole('super_admin'), requireNotHeldByOther, requestInformation);

/**
 * @openapi
 * /api/cases/{id}/documents:
 *   post:
 *     tags: [cases]
 *     summary: Upload missing documents to the IAS console for an API case waiting on them (SYSTEM_4 E4-04)
 *     description: >
 *       Any logged-in user. Only for an API case at API_NO_DOCUMENTS, API_CLAIM_SUSPENDED, API_DOCUMENTS_REVIEW,
 *       API_DOCUMENTS_UNSURE, API_DOCUMENTS_UPLOADED or API_UPLOAD_NOT_IN_CONSOLE. 1–10 PDF / JPG / PNG files, 20 MB in
 *       total, merged into one PDF and sent through cl-upload with the case's TPA case number. The case moves to
 *       API_DOCUMENTS_UPLOADED; api-console-watch picks the documents up once the console has them, and the case is
 *       checked again. A comment is required and kept in the case history.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [comment, files]
 *             properties:
 *               comment: { type: string, minLength: 3 }
 *               files:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     filename: { type: string }
 *                     contentType: { type: string }
 *                     data: { type: string, description: base64 }
 *     responses:
 *       200: { description: Uploaded; the case waits for the console }
 *       400: { description: No comment, wrong files, or the case isn't waiting on documents }
 *       413: { description: Over 20 MB }
 *       422: { description: The console refused the upload }
 *       502: { description: Console upload failed (network / server) — nothing changed }
 *       503: { description: Console upload not set up on this server }
 */
router.post('/:id/documents', requireNotHeldByOther, uploadCaseDocuments);

/**
 * @openapi
 * /api/cases/{id}/claim:
 *   post:
 *     tags: [cases]
 *     summary: Claim a case — "Being reviewed by …" (SYSTEM_4 E4-22)
 *     description: >
 *       While one person holds a case, others can view it but their case actions (override, correct, reset, release
 *       the missing-documents email, upload) answer 409. A claim lasts 30 minutes from the holder's last action;
 *       claiming again renews it. Held by someone else → 409, unless takeOver with a comment (kept in the case history).
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               takeOver: { type: boolean }
 *               comment: { type: string }
 *     responses:
 *       200: { description: Claimed (or renewed) }
 *       400: { description: Take-over without a comment }
 *       404: { description: Case not found }
 *       409: { description: Being reviewed by someone else }
 */
router.post('/:id/claim', requireRole('super_admin'), claim);

/**
 * @openapi
 * /api/cases/{id}/release:
 *   post:
 *     tags: [cases]
 *     summary: Give a claimed case back (SYSTEM_4 E4-22)
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Released (or nobody held it) }
 *       409: { description: Someone else holds it }
 */
router.post('/:id/release', requireRole('super_admin'), release);

module.exports = router;
