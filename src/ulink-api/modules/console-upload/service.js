const fs = require('fs');
const path = require('path');
const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { gatherAttachments } = require('../shared/gatherAttachments');
const { datePathSegments } = require('../shared/datePathSegments');

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
 * VS + yy + mm(base36) + dd(base36) + "1" (fixed project code) + 4 random digits. Takes the
 * date parts from the same `now` used for the destination folder (UTC, same as
 * datePathSegments) rather than re-reading local time separately, so the barcode and the
 * folder it's filed under can never disagree across a midnight boundary.
 */
function generateBarcode(now) {
  return [
    'VS',
    String(now.getUTCFullYear()).slice(-2),
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

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'MEMBER_VERIFIED', recognizedType: AYAS_REIMBURSEMENT_ROUTE },
    limit: config.consoleUpload.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await uploadCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
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

module.exports = { run, planUpload, uploadCase, buildFolder, generateBarcode, sanitize };
