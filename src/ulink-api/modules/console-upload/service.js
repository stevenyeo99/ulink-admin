const fs = require('fs');
const path = require('path');
const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { gatherAttachments } = require('../shared/gatherAttachments');
const { datePathSegments } = require('../shared/datePathSegments');
const { queueDedupedTask } = require('../shared/emailTaskQueue');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { mergeToPdf } = require('./mergePdf');
const { uploadToConsole, UploadRejected } = require('./clUploadClient');

const BLOCK_NAME = 'console-upload';

// The one enabled route this job applies to today (db/migrations/20260822090000-add-claim-
// recognition.js's seeded route_key) — written explicitly rather than "every MEMBER_VERIFIED
// case" so a second route added later isn't silently swept into this job without a decision.
const AYAS_REIMBURSEMENT_ROUTE = 'ayas_member_claim';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

// Same sanitization as email-intake/service.js's attachmentStorageKey safeName — OCR text
// (claimant name) and original filenames can carry characters unsafe for a filesystem path.
function sanitize(value) {
  return String(value || 'Unknown').replace(/[^\w.-]+/g, '_');
}

/**
 * Format drafted in docs/imp/demo/20260914/samples/console proto/demo_barcode_logic.md:
 * VS + yy(base36) + mm(base36) + dd(base36) + "1" (fixed project code) + 4 random digits —
 * a fixed 10 characters. Previously kept the year as 2 decimal digits (11 characters total),
 * which quietly diverged from the doc's own worked example ("VSQ9E1XXXX" for 14 Sep 2026)
 * and from routes/dev/consoleUpload.js's own OpenAPI example ("VSQ9F1XXXX") — both already
 * assumed the year is base36'd too. Fixed 2026-09-16 to match every other reference to this
 * format in the codebase.
 *
 * ponytail: yy(base36) is only guaranteed to stay a single character (and this function only
 * guaranteed 10 characters total) for yy 00-35, i.e. through 2035 — base36(36) is "10", two
 * characters. Not worth guarding against yet for a barcode whose case is always resolvable
 * by caseId regardless of collision; revisit if a fixed-width barcode format is ever a real
 * downstream requirement (e.g. a physical label template) rather than just documentation
 * consistency.
 *
 * Takes the date parts from the same `now` used for the destination folder (UTC, same as
 * datePathSegments) rather than re-reading local time separately, so the barcode and the
 * folder it's filed under can never disagree across a midnight boundary.
 */
function generateBarcode(now) {
  return [
    'VS',
    (now.getUTCFullYear() % 100).toString(36).toUpperCase(),
    String(now.getUTCMonth() + 1).toString(36).toUpperCase(),
    now.getUTCDate().toString(36).toUpperCase(),
    '1',
    String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
  ].join('');
}

// Pure — no I/O. `yyyy/MM/dd/{ddMMyyyy}{claimantName}-AYAS-{caseId}`, date parts all from the
// same `now` so the top-level partition and the subfolder name can never disagree.
function buildFolder({ now, claimantName, caseId }) {
  const [yyyy, mm, dd] = datePathSegments(now).split('/');
  return `${yyyy}/${mm}/${dd}/${dd}${mm}${yyyy}${sanitize(claimantName)}-AYAS-${caseId}`;
}

/**
 * Pure-ish (one DB read via gatherAttachments, no writes) — computes everything the real
 * upload needs (destination folder, barcode, which attachments) without touching disk or
 * the Case row. Shared by the real job and the dev preview endpoint so a preview is a
 * genuine dry run, not an approximation of one.
 */
async function planUpload(caseRecord) {
  const now = new Date();
  const folder = buildFolder({ now, claimantName: caseRecord.extractedFields?.claimant?.claimant_name, caseId: caseRecord.id });

  const attachments = await gatherAttachments(caseRecord.id);
  const files = attachments.map((attachment, index) => ({
    attachment,
    destFilename: `${index}-${sanitize(attachment.originalFilename)}`,
  }));

  return { caseId: caseRecord.id, folder, barcode: generateBarcode(now), files, completedAt: now };
}

// Deliberately a small dedicated write here rather than parametrizing storage/
// localDiskAdapter.js — that adapter's contract (rooted at STORAGE_ROOT) is depended on by
// email-intake/claim-recognition today; changing its shape for this one caller's different
// root (CONSOLE_UPLOAD_ROOT) is a bigger, riskier change than this.
async function writeToConsoleRoot(key, bytes) {
  const root = path.isAbsolute(config.consoleUpload.root) ? config.consoleUpload.root : path.resolve(process.cwd(), config.consoleUpload.root);
  const fullPath = path.join(root, key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, bytes);
}

async function uploadCase(caseRecord) {
  const plan = await planUpload(caseRecord);
  const storage = getStorageAdapter();

  for (const { attachment, destFilename } of plan.files) {
    const bytes = await storage.get(attachment.storageRef);
    await writeToConsoleRoot(`${plan.folder}/${destFilename}`, bytes);
  }

  return {
    caseId: plan.caseId,
    folder: plan.folder,
    barcode: plan.barcode,
    completedAt: plan.completedAt,
    files: plan.files.map(({ attachment, destFilename }) => ({ originalFilename: attachment.originalFilename, destFilename })),
  };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      {
        currentStatus: 'DOCUMENTS_UPLOADED',
        consoleBarcode: outcome.barcode,
        // completedAt: the moment documents were confirmed complete and archived (this job
        // only ever runs immediately after document-checking passes) — read back by
        // ias-claim-preparation/service.js for the CL_CLAIM_API payload's docCompleteDate.
        consoleUploadResult: { folder: outcome.folder, files: outcome.files, completedAt: outcome.completedAt.toISOString() },
      },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: 'DOCUMENTS_UPLOADED',
      message: `Copied ${outcome.files.length} file(s) to ${outcome.folder}`,
    });
  });
}

// --- Upload by API (cl-upload) ---------------------------------------------------------------
// config.consoleUpload.method === 'cl-upload' (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md).
// The console files the upload under API-<TpaCaseNumber>-NN and creates its barcode later (about every
// 15 minutes), so the case waits at CONSOLE_BARCODE_PENDING and the console-barcode job picks the barcode up.

// The case number the console files the upload under — and the key the barcode lookup searches. Email
// cases get it from the AI reading the claim form, so it's checked before anything is uploaded.
const CASE_NUMBER = /^AYA-CL-\d{8}$/;

// Internal notice when a cl-upload case needs a person (also used by console-barcode). Once per problem.
async function queueConsoleUploadIssue(transaction, caseRecord, { status, problem, detail }) {
  const fields = { ...(caseRecord.toJSON ? caseRecord.toJSON() : caseRecord), currentStatus: status };
  await queueDedupedTask(transaction, {
    caseId: caseRecord.id,
    taskType: 'CONSOLE_UPLOAD_ISSUE',
    dedupeKey: status,
    payload: { caseId: caseRecord.id, problem, detail, assessment: assessmentSummaryText(buildAssessmentSummary(fields)) },
  });
}

async function uploadByApi(caseRecord, tpaCaseNumber) {
  const attachments = await gatherAttachments(caseRecord.id);
  const storage = getStorageAdapter();
  const files = [];
  for (const attachment of attachments) {
    files.push({ bytes: await storage.get(attachment.storageRef), contentType: attachment.contentType, filename: attachment.originalFilename });
  }
  const { pdf, pageCount, skipped } = await mergeToPdf(files);
  const file = `${tpaCaseNumber}.pdf`;
  const uploadedAt = new Date();
  const { path: consolePath } = await uploadToConsole({ tpaCaseNumber, pdf, filename: file });
  return {
    method: 'cl-upload',
    tpaCaseNumber,
    uploadedAt: uploadedAt.toISOString(),
    // Read back as the claim's docCompleteDate (ias-claim-preparation), same as the folder method.
    completedAt: uploadedAt.toISOString(),
    path: consolePath,
    file,
    sizeBytes: pdf.length,
    pageCount,
    files: attachments.map((a) => a.originalFilename),
    skipped,
  };
}

async function persistStatus(caseRecord, { status, fields = {}, reasonCode = null, message, issue = null }) {
  return sequelize.transaction(async (transaction) => {
    await Case.update({ currentStatus: status, ...fields }, { where: { id: caseRecord.id }, transaction });
    await logEvent(transaction, { caseId: caseRecord.id, prevStatus: caseRecord.currentStatus, newStatus: status, reasonCode, message });
    if (issue) await queueConsoleUploadIssue(transaction, { ...caseRecord.toJSON?.() ?? caseRecord, ...fields, id: caseRecord.id }, { status, ...issue });
  });
}

async function runByApi(caseRecord) {
  const tpaCaseNumber = (caseRecord.extractedFields?.claim?.insurer_case_number || '').trim();
  if (!CASE_NUMBER.test(tpaCaseNumber)) {
    const detail = `The case number read from the claim form is "${tpaCaseNumber || '(none)'}"; it should be AYA-CL- and 8 digits. Nothing was uploaded.`;
    return persistStatus(caseRecord, { status: 'CASE_NUMBER_UNCLEAR', reasonCode: 'CASE_NUMBER_UNCLEAR', message: detail, issue: { problem: 'Case number unclear', detail } });
  }
  let result;
  try {
    result = await uploadByApi(caseRecord, tpaCaseNumber);
  } catch (error) {
    if (!(error instanceof UploadRejected)) throw error; // technical: stays at MEMBER_VERIFIED, retried next run
    return persistStatus(caseRecord, { status: 'CONSOLE_UPLOAD_FAILED', reasonCode: 'CONSOLE_UPLOAD_REFUSED', message: error.message, issue: { problem: 'Upload refused', detail: error.message } });
  }
  const skipped = result.skipped.length ? ` (not a PDF or image, left out: ${result.skipped.join(', ')})` : '';
  return persistStatus(caseRecord, {
    status: 'CONSOLE_BARCODE_PENDING',
    fields: { consoleUploadResult: result },
    message: `Uploaded ${result.files.length} file(s) to the console as ${result.file} (${result.pageCount} page(s))${skipped}; waiting for its barcode`,
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'MEMBER_VERIFIED', recognizedType: AYAS_REIMBURSEMENT_ROUTE },
    limit: config.consoleUpload.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      if (config.consoleUpload.method === 'cl-upload') {
        await runByApi(caseRecord);
      } else {
        const outcome = await uploadCase(caseRecord);
        await persistOutcome(caseRecord, outcome);
      }
      results.push({ caseId: caseRecord.id, ok: true });
    } catch (error) {
      // Left at MEMBER_VERIFIED for retry on the next run — same pattern as every other
      // job's technical-failure handling (e.g. document-checking's run()).
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, planUpload, uploadCase, buildFolder, generateBarcode, sanitize, queueConsoleUploadIssue, CASE_NUMBER };
