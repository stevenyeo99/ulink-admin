const express = require('express');
const createJobRouter = require('./createJobRouter');

const emailIntakeService = require('../../modules/email-intake/service');
const claimRecognitionService = require('../../modules/claim-recognition/service');
const documentCheckingService = require('../../modules/document-checking/service');
const emailSenderService = require('../../modules/email-sender/service');
const memberVerificationService = require('../../modules/member-verification/service');
const iasClaimPreparationService = require('../../modules/ias-claim-preparation/service');
const iasClaimCreationService = require('../../modules/ias-claim-creation/service');

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
 *       Case.recognizedType/extractedFields, and logs a CaseEvent. On NOT_RECOGNIZED
 *       (submission didn't match any enabled claim route), also queues a
 *       SUBMISSION_NOT_RECOGNIZED EmailTask asking the sender to contact CS directly —
 *       deliberately not queued for MANUAL_REVIEW, since a route DID match there. Same
 *       lock/release pattern as email-intake.
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
 *
 * /api/jobs/member-verification/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the member-verification job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each case at
 *       currentStatus=DOCUMENT_CHECKED or MEMBER_REVIEW_REQUIRED (up to
 *       MEMBER_VERIFICATION_BATCH_LIMIT per run, oldest-updated first — MEMBER_REVIEW_REQUIRED
 *       is included so a case that only failed due to stale IAS data can recover on a later
 *       run): calls the IAS GET_MEMBER_INFO_API with the claimant's NRC and accident date
 *       (modules/member-verification/iasClient.js), then runs deterministic Hard/Soft field
 *       comparisons (modules/member-verification/checks.js — coverage-active date range,
 *       DOB, bank details vs IAS's on-file payee record, policy number). Updates
 *       Case.currentStatus to MEMBER_VERIFIED or MEMBER_REVIEW_REQUIRED, sets
 *       Case.memberVerifyResult (evaluated summary) and Case.iasMemberInfoResponse (the raw
 *       IAS response verbatim, kept for the future ias-claim-creation job and audit — see
 *       docs/imp/day1/jobs-registry.md), and logs a CaseEvent. On MEMBER_VERIFIED, queues a
 *       DOCUMENT_COMPLETE_ACK EmailTask. On MEMBER_REVIEW_REQUIRED (any reasonCode —
 *       MEMBER_NOT_FOUND, COVERAGE_NOT_ACTIVE, MEMBER_DETAILS_MISMATCH, or
 *       BANK_DETAILS_MISMATCH), queues a customer-facing MEMBER_VERIFY_ISSUE EmailTask
 *       flagging the one line that reasonCode maps to (modules/member-verification/service.js's
 *       REASON_CODE_TO_ISSUE) — deduped so a re-check finding the same outcome doesn't
 *       re-queue. A technical failure (IAS timeout/error, missing required fields) leaves the
 *       case at its current status for retry on the next run, same pattern as
 *       document-checking. Same lock/release pattern as the other jobs.
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
 *                 value: { block: member-verification, started: true }
 *               skipped:
 *                 value: { block: member-verification, skipped: true, reason: already_running }
 *
 * /api/jobs/member-verification/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck member-verification lock
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
 *               block: member-verification
 *               released: true
 *               wasLocked: true
 *
 * /api/jobs/ias-claim-preparation/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the ias-claim-preparation job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each case at
 *       currentStatus=MEMBER_VERIFIED (up to IAS_CLAIM_PREPARATION_BATCH_LIMIT per run):
 *       picks the best ICD-10 diagnosis code via the vector RAG in modules/icd10/ plus one
 *       LLM call (modules/ias-claim-preparation/diagnosisPicker.js), picks the best
 *       BenefitType/BenefitHead from the member's own plan's valid combinations via another
 *       LLM call (modules/ias-claim-preparation/benefitPicker.js), then builds the full
 *       CL_CLAIM_API request payload (modules/ias-claim-preparation/payloadBuilder.js,
 *       verified against the real sample in docs/imp/day1/IAS/ias_claim_submission_api.json).
 *       Sets Case.iasClaimPayload and Case.currentStatus=CLAIM_PAYLOAD_PREPARED, logs a
 *       CaseEvent. A diagnosis/benefit pick that comes back null does NOT block
 *       preparation — the payload still gets built and the case still proceeds, with those
 *       fields left null (IAS's own validation to catch, not pre-empted here). A technical
 *       failure (LLM error, missing extractedFields/iasMemberInfoResponse) leaves the case
 *       at MEMBER_VERIFIED for retry on the next run, same pattern as the other jobs. Same
 *       lock/release pattern as the other jobs.
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
 *                 value: { block: ias-claim-preparation, started: true }
 *               skipped:
 *                 value: { block: ias-claim-preparation, skipped: true, reason: already_running }
 *
 * /api/jobs/ias-claim-preparation/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck ias-claim-preparation lock
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
 *               block: ias-claim-preparation
 *               released: true
 *               wasLocked: true
 *
 * /api/jobs/ias-claim-creation/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the ias-claim-creation job (fire-and-forget)
 *     description: >
 *       Acquires the job lock and returns immediately. In the background, for each case at
 *       currentStatus=CLAIM_PAYLOAD_PREPARED (up to IAS_CLAIM_CREATION_BATCH_LIMIT per run):
 *       submits Case.iasClaimPayload to the real IAS CL_CLAIM_API
 *       (modules/ias-claim-creation/iasClaimClient.js). On success, sets
 *       Case.currentStatus=CLAIM_CREATED, Case.claimNo (the real assigned claim number),
 *       Case.iasClaimResult, logs a CaseEvent, and queues a CLAIM_CREATED_NOTIFICATION
 *       EmailTask (a new, distinct customer email — DOCUMENT_COMPLETE_ACK at
 *       MEMBER_VERIFIED is unrelated and unaffected, both are sent). On a real business
 *       rejection from IAS (success:false with a reason, e.g. "Claim already exists"), sets
 *       Case.currentStatus=CLAIM_SUBMIT_FAILED, stores the error, and queues a
 *       CLAIM_SUBMIT_ISSUE EmailTask notifying the customer (generic wording — the raw IAS
 *       error stays internal, in Case.iasClaimResult/the CaseEvent, for admin follow-up) —
 *       this is NOT retried, since retrying a definitive rejection would never resolve it;
 *       needs manual follow-up. A technical failure (timeout, network error, missing iasClaimPayload)
 *       leaves the case at CLAIM_PAYLOAD_PREPARED for retry on the next run — this IS
 *       retried, same pattern as the other jobs. Same lock/release pattern as the other
 *       jobs. Non-idempotent, real external side effect — unlike every other job here,
 *       there's no dry-run/validate-only mode confirmed on IAS's side.
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
 *                 value: { block: ias-claim-creation, started: true }
 *               skipped:
 *                 value: { block: ias-claim-creation, skipped: true, reason: already_running }
 *
 * /api/jobs/ias-claim-creation/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck ias-claim-creation lock
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
 *               block: ias-claim-creation
 *               released: true
 *               wasLocked: true
 */
router.use('/email-intake', createJobRouter('email-intake', emailIntakeService));
router.use('/claim-recognition', createJobRouter('claim-recognition', claimRecognitionService));
router.use('/document-checking', createJobRouter('document-checking', documentCheckingService));
router.use('/email-sender', createJobRouter('email-sender', emailSenderService));
router.use('/member-verification', createJobRouter('member-verification', memberVerificationService));
router.use('/ias-claim-preparation', createJobRouter('ias-claim-preparation', iasClaimPreparationService));
router.use('/ias-claim-creation', createJobRouter('ias-claim-creation', iasClaimCreationService));

module.exports = router;
