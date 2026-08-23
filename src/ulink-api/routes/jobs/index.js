const express = require('express');
const createJobRouter = require('./createJobRouter');

const emailIntakeService = require('../../modules/email-intake/service');
const claimRecognitionService = require('../../modules/claim-recognition/service');
const documentCheckingService = require('../../modules/document-checking/service');
const emailSenderService = require('../../modules/email-sender/service');

const router = express.Router();

/**
 * @openapi
 * /api/jobs/email-intake/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the email-intake job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately — the actual fetch (unseen IMAP
 *       messages, Case + EmailThread matching, attachment storage, CaseEvent logging)
 *       runs in the background after the response is sent, so a slow or stuck downstream
 *       call (IMAP/DB) can never hang this request. The batch's result (processed count,
 *       per-message errors) is NOT returned here — check server logs or the CaseEvent/Case
 *       rows for the outcome. Guarded by a Postgres-backed lock (ulink_job_locks) so
 *       overlapping cron triggers skip instead of running concurrently; if the process
 *       crashes mid-run the lock can be cleared via POST .../release.
 *     requestBody:
 *       required: false
 *       description: No body needed — trigger only.
 *     responses:
 *       200:
 *         description: Started, or skipped because a prior run is still in progress
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     started: { type: boolean }
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     skipped: { type: boolean }
 *                     reason: { type: string }
 *             examples:
 *               started:
 *                 summary: Lock acquired, batch running in the background
 *                 value:
 *                   block: email-intake
 *                   started: true
 *               skipped:
 *                 summary: A prior run is still in progress
 *                 value:
 *                   block: email-intake
 *                   skipped: true
 *                   reason: already_running
 *
 * /api/jobs/email-intake/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck email-intake lock
 *     description: >
 *       Use when the API process died or was restarted mid-run, so the /run handler's
 *       cleanup never executed and ulink_job_locks is left with running=true forever.
 *       Idempotent — safe to call whether or not the lock was actually held.
 *     requestBody:
 *       required: false
 *       description: No body needed.
 *     responses:
 *       200:
 *         description: Lock cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 block: { type: string }
 *                 released: { type: boolean }
 *                 wasLocked: { type: boolean, description: Whether the lock was actually held before this call. }
 *             example:
 *               block: email-intake
 *               released: true
 *               wasLocked: true
 *
 * /api/jobs/claim-recognition/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the claim-recognition job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each case
 *       at currentStatus=READY_FOR_DOCUMENT_READING (up to CLAIM_RECOGNITION_BATCH_LIMIT
 *       per run): rasterizes every attachment across the whole case thread into page
 *       images, transcribes each page via a vision LLM call, then a text-only LLM call
 *       decides the route (against ulink_claim_routes) and extracts fields into a fixed
 *       JSON shape validated by ajv against the matched route's schema. Updates
 *       Case.currentStatus to RECOGNIZED / NOT_RECOGNIZED / MANUAL_REVIEW, sets
 *       Case.recognizedType/extractedFields, and logs a CaseEvent. Same lock/release
 *       pattern as email-intake.
 *     requestBody:
 *       required: false
 *       description: No body needed — trigger only.
 *     responses:
 *       200:
 *         description: Started, or skipped because a prior run is still in progress
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     started: { type: boolean }
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     skipped: { type: boolean }
 *                     reason: { type: string }
 *             examples:
 *               started:
 *                 value: { block: claim-recognition, started: true }
 *               skipped:
 *                 value: { block: claim-recognition, skipped: true, reason: already_running }
 *
 * /api/jobs/claim-recognition/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck claim-recognition lock
 *     requestBody:
 *       required: false
 *       description: No body needed.
 *     responses:
 *       200:
 *         description: Lock cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 block: { type: string }
 *                 released: { type: boolean }
 *                 wasLocked: { type: boolean }
 *             example:
 *               block: claim-recognition
 *               released: true
 *               wasLocked: true
 *
 * /api/jobs/document-checking/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the document-checking job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each case
 *       at currentStatus=RECOGNIZED (up to DOCUMENT_CHECKING_BATCH_LIMIT per run): runs
 *       the 11 checklist evaluators (modules/document-checking/checklist.js) purely over
 *       Case.extractedFields — no LLM call, no external dependency, deterministic. Updates
 *       Case.currentStatus to DOCUMENT_CHECKED (no issues) or INCOMPLETE (one or more
 *       issues), sets Case.documentCheckResult, and logs a CaseEvent. Same lock/release
 *       pattern as the other jobs. Note: "Incorrect bank details" is not evaluated here —
 *       it requires the member-verification block (not built yet).
 *     requestBody:
 *       required: false
 *       description: No body needed — trigger only.
 *     responses:
 *       200:
 *         description: Started, or skipped because a prior run is still in progress
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     started: { type: boolean }
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     skipped: { type: boolean }
 *                     reason: { type: string }
 *             examples:
 *               started:
 *                 value: { block: document-checking, started: true }
 *               skipped:
 *                 value: { block: document-checking, skipped: true, reason: already_running }
 *
 * /api/jobs/document-checking/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck document-checking lock
 *     requestBody:
 *       required: false
 *       description: No body needed.
 *     responses:
 *       200:
 *         description: Lock cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 block: { type: string }
 *                 released: { type: boolean }
 *                 wasLocked: { type: boolean }
 *             example:
 *               block: document-checking
 *               released: true
 *               wasLocked: true
 *
 * /api/jobs/email-sender/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the email-sender job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each
 *       ulink_email_tasks row at status=PENDING (up to EMAIL_SENDER_BATCH_LIMIT per run):
 *       renders the task's template (modules/email-sender/templates.js), sends it via the
 *       configured channel adapter's sendReply (channels/imapSmtpChannel.js, SMTP) as a
 *       reply in the case's existing email thread, records the outbound EmailMessage,
 *       flips the task to SENT, and logs a CaseEvent. A per-task failure is retried on
 *       later runs up to EMAIL_SENDER_MAX_ATTEMPTS before the task is marked FAILED; it
 *       does not block other tasks in the same batch. Same lock/release pattern as the
 *       other jobs. Tasks are created by validators (document-checking today; a future
 *       member-verify/JD2 module for DOCUMENT_COMPLETE_ACK), never by this job itself.
 *     requestBody:
 *       required: false
 *       description: No body needed — trigger only.
 *     responses:
 *       200:
 *         description: Started, or skipped because a prior run is still in progress
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     started: { type: boolean }
 *                 - type: object
 *                   properties:
 *                     block: { type: string }
 *                     skipped: { type: boolean }
 *                     reason: { type: string }
 *             examples:
 *               started:
 *                 value: { block: email-sender, started: true }
 *               skipped:
 *                 value: { block: email-sender, skipped: true, reason: already_running }
 *
 * /api/jobs/email-sender/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck email-sender lock
 *     requestBody:
 *       required: false
 *       description: No body needed.
 *     responses:
 *       200:
 *         description: Lock cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 block: { type: string }
 *                 released: { type: boolean }
 *                 wasLocked: { type: boolean }
 *             example:
 *               block: email-sender
 *               released: true
 *               wasLocked: true
 */
router.use('/email-intake', createJobRouter('email-intake', emailIntakeService));
router.use('/claim-recognition', createJobRouter('claim-recognition', claimRecognitionService));
router.use('/document-checking', createJobRouter('document-checking', documentCheckingService));
router.use('/email-sender', createJobRouter('email-sender', emailSenderService));

module.exports = router;
