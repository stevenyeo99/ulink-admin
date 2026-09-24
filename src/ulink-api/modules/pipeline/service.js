const { PipelineRun, PipelineRunStep } = require('../../db/models');
const config = require('../../config');
const logger = require('../../utils/logger');
const jobLock = require('../../jobs/jobLock');

const emailIntakeService = require('../email-intake/service');
const claimRecognitionService = require('../claim-recognition/service');
const documentCheckingService = require('../document-checking/service');
const memberVerificationService = require('../member-verification/service');
const emailSenderService = require('../email-sender/service');
const consoleUploadService = require('../console-upload/service');
const iasClaimPreparationService = require('../ias-claim-preparation/service');
const iasClaimCreationService = require('../ias-claim-creation/service');
const iasClaimStpService = require('../ias-claim-stp/service');
const apiClaimIntakeService = require('../api-claim-intake/service');
const apiMaterialDownloadService = require('../api-material-download/service');

// Fixed order — later steps read the Case.currentStatus earlier steps write, per
// docs/imp/day1/jobs-registry.md's "Orchestrator" section. Each block keeps its own
// independent /api/jobs/<name>/run endpoint too; this only consolidates scheduling.
//
// member-verification now runs BEFORE document-checking (swapped 2026-09-01 per demo
// feedback — end user wants member/coverage eligibility checked first). See those two
// modules' own service.js comments for the currentStatus values each reads/writes:
// member-verification now takes RECOGNIZED and hands off via READY_FOR_DOCUMENT_CHECKING;
// document-checking now takes that and is the one that writes the final MEMBER_VERIFIED
// gate. MEMBER_VERIFIED as a literal string is unchanged and still means "both checks
// passed" — only which job sets it changed. ias-claim-preparation itself now reads
// DOCUMENTS_UPLOADED instead (console-upload sits in between as of 2026-09-15 — see below).
//
// Email tasks are split into four visible steps so the console can show which category is
// loading. Each step still uses the same idempotent sender, filtered to its own task types.
const STEPS = [
  ['email-intake', emailIntakeService],
  ['claim-recognition', claimRecognitionService],
  ['member-verification', memberVerificationService],
  ['document-checking', documentCheckingService],
  ['email-sender-member-verification', { run: () => emailSenderService.run({ taskTypes: ['MEMBER_VERIFY_ISSUE'] }) }],
  ['email-sender-document-checking', { run: () => emailSenderService.run({ taskTypes: ['MISSING_DOCUMENTS', 'DOCUMENT_COMPLETE_ACK'] }) }],
  // Added 2026-09-15 — copies a cleared AYAS-reimbursement case's documents to the shared
  // console folder and generates its barcode (Case.consoleBarcode) before ias-claim-
  // preparation needs it. MEMBER_VERIFIED -> DOCUMENTS_UPLOADED; see
  // modules/console-upload/service.js.
  ['console-upload', consoleUploadService],
  ['ias-claim-preparation', iasClaimPreparationService],
  ['ias-claim-creation', iasClaimCreationService],
  ['email-sender-claim-approval-review', { run: () => emailSenderService.run({ taskTypes: ['CLAIM_APPROVAL_REVIEW', 'CLAIM_SUBMIT_ISSUE'] }) }],
  // Added 2026-09-15 — for STP (Case.isStp) claims only: polls IAS claim-status for the
  // settlement report, downloads it once ready, emails it to the customer.
  // CLAIM_CREATED -> CSR_SENT; see modules/ias-claim-stp/service.js. Runs before this last
  // email-sender pass so a CSR_REPORT task queued in the same run still sends immediately,
  // same reasoning as ias-claim-creation's own CLAIM_CREATED_NOTIFICATION task above.
  ['ias-claim-stp', iasClaimStpService],
  ['email-sender-csr-report', { run: () => emailSenderService.run({ taskTypes: ['CSR_REPORT'] }) }],
];

// API case workflow (docs/imp/day1/api-case-workflow.md section 5) — its own orchestrator,
// POST /api/jobs/api-pipeline/run. Only jobs that exist are listed; each phase adds its own
// (email-intake joins when API replies are routed, Phase 4). Its jobs only ever select
// source='API' cases, and the email STEPS above can't see them (DB check on ulink_cases).
const API_STEPS = [
  ['api-claim-intake', apiClaimIntakeService],
  ['api-material-download', apiMaterialDownloadService],
];

const PIPELINES = { EMAIL: STEPS, API: API_STEPS };

function withTimeout(promise, ms, blockName) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${blockName} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs one step: acquires that block's own per-block lock (same one its individual
 * /run endpoint uses), so this can never run a block concurrently with either a
 * separate cron trigger of that same block or another pipeline run. If the lock is
 * held, the step is SKIPPED, not FAILED — that's expected/healthy, not an error.
 */
async function runStep(pipelineRunId, blockName, service, sequence) {
  const step = await PipelineRunStep.create({
    pipelineRunId,
    blockName,
    sequence,
    status: 'PENDING',
  });

  const acquired = await jobLock.acquire(blockName);
  if (!acquired) {
    await step.update({ status: 'SKIPPED', skipReason: 'already_running', finishedAt: new Date() });
    return;
  }

  await step.update({ status: 'RUNNING', startedAt: new Date() });

  try {
    const result = await withTimeout(service.run(), config.pipeline.stepTimeoutMs, blockName);
    await step.update({ status: 'DONE', resultSummary: result, finishedAt: new Date() });
  } catch (error) {
    logger.error(`Pipeline step ${blockName} failed`, { error: error.message, stack: error.stack });
    await step.update({ status: 'FAILED', errorMessage: error.message, finishedAt: new Date() });
    // Deliberately not rethrown — continue-on-error, see modules/pipeline/service.js's
    // module comment / docs/imp/day1/jobs-registry.md. Every step here is already
    // decoupled via Case.currentStatus and idempotent, so one step failing doesn't
    // invalidate the rest; aborting would just delay unrelated work.
  } finally {
    await jobLock.release(blockName);
  }
}

/**
 * Creates the PipelineRun row and returns immediately — split out from executeSteps()
 * so a caller (controllers/job/pipelineController.js) can respond with the new run's id
 * right away, then let the actual step loop run in the background, same fire-and-forget
 * shape as every individual job endpoint.
 */
async function startRun(pipeline = 'EMAIL') {
  return PipelineRun.create({ pipeline, status: 'RUNNING', startedAt: new Date() });
}

/** Runs the run's own pipeline steps in order against an already-created PipelineRun, then finalizes it. */
async function executeSteps(pipelineRun) {
  try {
    let sequence = 0;
    for (const [blockName, service] of PIPELINES[pipelineRun.pipeline]) {
      await runStep(pipelineRun.id, blockName, service, sequence);
      sequence += 1;
    }

    const failedCount = await PipelineRunStep.count({ where: { pipelineRunId: pipelineRun.id, status: 'FAILED' } });
    await pipelineRun.update({
      status: failedCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      finishedAt: new Date(),
    });
  } catch (error) {
    logger.error('Pipeline run failed', { pipelineRunId: pipelineRun.id, error: error.message, stack: error.stack });
    await pipelineRun.update({ status: 'FAILED', finishedAt: new Date() });
  }

  return pipelineRun;
}

/** Convenience wrapper (startRun + executeSteps) — useful for tests/manual invocation. */
async function run() {
  const pipelineRun = await startRun();
  return executeSteps(pipelineRun);
}

module.exports = { run, startRun, executeSteps, STEPS, API_STEPS, PIPELINES };
