const express = require('express');
const createJobRouter = require('./createJobRouter');

const emailIntakeService = require('../../modules/email-intake/service');
const claimRecognitionService = require('../../modules/claim-recognition/service');

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
 */
router.use('/email-intake', createJobRouter('email-intake', emailIntakeService));
router.use('/claim-recognition', createJobRouter('claim-recognition', claimRecognitionService));

module.exports = router;
