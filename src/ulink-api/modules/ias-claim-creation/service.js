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

// Internal-only (see email-sender/service.js's INTERNAL_ONLY_TASK_TYPES) — replaces the old
// CLAIM_CREATED_NOTIFICATION customer email. This system has no way to detect JD2's later
// approval (Case.currentStatus never advances past CLAIM_CREATED — final determination is
// outside JD1 scope per SOP §14), so telling the customer their claim number is now a
// manual step for ops once they've reviewed/approved, not automatic. This email is the
// SOP §13 "ready for JD2 handover" signal, fired at exactly the point JD1's automated work
// ends.
async function queueClaimApprovalReviewEmail(transaction, caseId, claimNo) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'CLAIM_APPROVAL_REVIEW',
    dedupeKey: null,
    payload: { caseId, claimNo },
  });
}

// Internal-only, same reasoning as MEMBER_VERIFY_ISSUE — a real IAS rejection is exactly
// the kind of thing that needs internal follow-up, not a generic "our team will review"
// customer email while the actual reason sits unused in the DB. dedupeKey on the error
// text: a case retried after a genuinely different rejection reason gets a fresh email;
// the exact same rejection re-surfacing (shouldn't happen, since CLAIM_SUBMIT_FAILED isn't
// retried — defensive only) won't double-send.
async function queueClaimSubmitIssueEmail(transaction, caseId, errorMessage) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'CLAIM_SUBMIT_ISSUE',
    dedupeKey: errorMessage || null,
    payload: { caseId, errorMessage },
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
      // STP claims are already approved through straight-through processing; only non-STP
      // claims need an internal review/approval notification. Null preserves the safe
      // non-STP behavior for older cases created before isStp was populated.
      if (caseRecord.isStp !== true) {
        await queueClaimApprovalReviewEmail(transaction, caseRecord.id, claimNo);
      }
    } else {
      // A real business rejection from IAS (e.g. "Claim already exists"), not a technical
      // failure — do NOT retry (retrying "already exists" forever would never resolve).
      // Case sits at CLAIM_SUBMIT_FAILED for manual follow-up, and internal ops is notified
      // via CLAIM_SUBMIT_ISSUE (internal-only — the raw IAS error is exactly what ops needs
      // to act on, not customer-safe wording; see queueClaimSubmitIssueEmail above).
      const errorMessage = response.error || 'IAS rejected the claim submission';
      await Case.update(
        { currentStatus: 'CLAIM_SUBMIT_FAILED', iasClaimResult: response },
        { where: { id: caseRecord.id }, transaction }
      );
      await logEvent(transaction, {
        caseId: caseRecord.id,
        prevStatus,
        newStatus: 'CLAIM_SUBMIT_FAILED',
        reasonCode: 'IAS_REJECTED',
        message: errorMessage,
      });
      await queueClaimSubmitIssueEmail(transaction, caseRecord.id, errorMessage);
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
