const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { submitClaim } = require('./iasClaimClient');
const { queueDedupedTask } = require('../shared/emailTaskQueue');

const BLOCK_NAME = 'ias-claim-creation';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * Not pure — makes a real, non-idempotent call to IAS's live claim-submission API. The dev
 * preview endpoint calls this same function and genuinely submits for real; there is no
 * confirmed "validate without creating" mode to fall back on (see payloadBuilder's
 * isValidation:"N" — a real submission, not a dry-run flag).
 *
 * Throws only for a technical failure (network/timeout/non-2xx) — that's the caller's
 * signal to retry. A real IAS answer, success or business rejection, is always a normal
 * return value, never thrown.
 */
async function checkCase(caseRecord) {
  const iasClaimPayload = caseRecord.iasClaimPayload;
  if (!iasClaimPayload) {
    throw new Error(`Case ${caseRecord.id} has no iasClaimPayload (reached CLAIM_PAYLOAD_PREPARED without one)`);
  }

  const response = await submitClaim(iasClaimPayload);
  return { caseId: caseRecord.id, response };
}

async function queueClaimCreatedNotification(transaction, caseId, claimNo) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'CLAIM_CREATED_NOTIFICATION',
    dedupeKey: null,
    payload: { claimNo },
  });
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const { response } = outcome;

    if (response.success === true) {
      const claimNo = response.payload?.claimNo ?? null;
      await Case.update(
        { currentStatus: 'CLAIM_CREATED', claimNo, iasClaimResult: response },
        { where: { id: caseRecord.id }, transaction }
      );
      await logEvent(transaction, {
        caseId: caseRecord.id,
        prevStatus,
        newStatus: 'CLAIM_CREATED',
        message: `Claim created, claimNo=${claimNo ?? 'null'}`,
      });
      await queueClaimCreatedNotification(transaction, caseRecord.id, claimNo);
    } else {
      // A real business rejection from IAS (e.g. "Claim already exists"), not a technical
      // failure — do NOT retry (retrying "already exists" forever would never resolve).
      // Case sits at CLAIM_SUBMIT_FAILED for manual follow-up; no email queued (no
      // confirmed requirement for one on this path yet).
      await Case.update(
        { currentStatus: 'CLAIM_SUBMIT_FAILED', iasClaimResult: response },
        { where: { id: caseRecord.id }, transaction }
      );
      await logEvent(transaction, {
        caseId: caseRecord.id,
        prevStatus,
        newStatus: 'CLAIM_SUBMIT_FAILED',
        reasonCode: 'IAS_REJECTED',
        message: response.error || 'IAS rejected the claim submission',
      });
    }
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'CLAIM_PAYLOAD_PREPARED' },
    limit: config.iasClaimCreation.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await checkCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true });
    } catch (error) {
      // Technical failure (IAS timeout/error, missing payload) — case is left at
      // CLAIM_PAYLOAD_PREPARED and retried on the next run. A business rejection never
      // reaches here — persistOutcome handles that as a normal (non-throwing) outcome.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase, persistOutcome };
