const fs = require('fs');
const path = require('path');
const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getClaimStatus, downloadFile } = require('./iasClaimStatusClient');
const { datePathSegments } = require('../shared/datePathSegments');
const { queueDedupedTask } = require('../shared/emailTaskQueue');

const BLOCK_NAME = 'ias-claim-stp';

// The one status this codebase's real sample data confirms carries a downloadable
// settlement report (see docs/imp/day1/IAS/ias_get_claim_status_response.json — the one row
// with a non-empty FILENAME/PATH also has this status). Confirmed explicitly, not guessed:
// requiring BOTH the status and non-empty filename/path, stricter than "any row with a
// filename".
const READY_STATUS = 'CL_STATUS_FC';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, message }, { transaction });
}

// One-off format this endpoint alone wants ("01162026_00:00") — not added to
// shared/iasDates.js since nothing else in this codebase uses this exact suffixed shape.
function buildFromDatetime(now) {
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const yyyy = String(now.getUTCFullYear());
  return `${mm}${dd}${yyyy}_00:00`;
}

// Pure — no I/O. Finds the one results[] row that means "the settlement report exists",
// per this file's READY_STATUS comment above.
function findReadyReport(results) {
  if (!Array.isArray(results)) return null;
  return results.find((row) => row?.SCMA_OID_CL_STATUS === READY_STATUS && row?.FILENAME && row?.PATH) ?? null;
}

/**
 * Real IAS call (getClaimStatus), no persistence, no download — safe to call from the dev
 * preview endpoint. Returns { ready: false } if no report row exists yet, or
 * { ready: true, filename, filepath } once one does.
 */
async function checkClaimStatus(caseRecord) {
  const now = new Date();
  const response = await getClaimStatus({ claimNo: caseRecord.claimNo, fromDatetime: buildFromDatetime(now) });
  const report = findReadyReport(response?.payload?.results);

  if (!report) return { caseId: caseRecord.id, ready: false };
  return { caseId: caseRecord.id, ready: true, filename: report.FILENAME, filepath: report.PATH };
}

function csrDestination({ now, claimNo, filename }) {
  return `${datePathSegments(now)}/${claimNo}/CSR/${filename}`;
}

// Deliberately a small dedicated write here, same reasoning as console-upload's
// writeToConsoleRoot: this root (CSR_UPLOAD_ROOT) is unrelated to STORAGE_ROOT/
// CONSOLE_UPLOAD_ROOT, not worth parametrizing the shared local-disk adapter for.
async function writeToCsrRoot(key, bytes) {
  const root = path.isAbsolute(config.csrUpload.root) ? config.csrUpload.root : path.resolve(process.cwd(), config.csrUpload.root);
  const fullPath = path.join(root, key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, bytes);
  return fullPath;
}

async function downloadAndStore(caseRecord, report) {
  const bytes = await downloadFile({ filepath: report.filepath, filename: report.filename });
  const destKey = csrDestination({ now: new Date(), claimNo: caseRecord.claimNo, filename: report.filename });
  const csrFilePath = await writeToCsrRoot(destKey, bytes);
  return { csrFilePath, filename: report.filename };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update({ currentStatus: 'CSR_SENT' }, { where: { id: caseRecord.id }, transaction });

    await queueDedupedTask(transaction, {
      caseId: caseRecord.id,
      taskType: 'CSR_REPORT',
      dedupeKey: null,
      payload: { csrFilePath: outcome.csrFilePath, claimNo: caseRecord.claimNo },
    });

    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: 'CSR_SENT',
      message: `CSR downloaded to ${outcome.csrFilePath}`,
    });
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'CLAIM_CREATED', isStp: true },
    limit: config.csrUpload.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const status = await checkClaimStatus(caseRecord);
      if (!status.ready) {
        // Not an error — the report just isn't ready yet. Case stays at CLAIM_CREATED,
        // retried next run, no CaseEvent noise for a normal wait state.
        results.push({ caseId: caseRecord.id, ok: true, ready: false });
        continue;
      }

      const outcome = await downloadAndStore(caseRecord, status);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: caseRecord.id, ok: true, ready: true });
    } catch (error) {
      // Genuine technical failure (IAS timeout/error, disk I/O error) — left at
      // CLAIM_CREATED for retry, same pattern as every other job.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok && r.ready).length;
  const pending = results.filter((r) => r.ok && !r.ready).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, pending, errors };
}

module.exports = { run, checkClaimStatus, findReadyReport, buildFromDatetime, csrDestination };
