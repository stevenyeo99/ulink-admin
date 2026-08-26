const { sequelize, Sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getMemberInfo } = require('./iasClient');
const { evaluate } = require('./checks');
const { queueDedupedTask } = require('../shared/emailTaskQueue');
const { ISSUES } = require('../document-checking/checklist');

const BLOCK_NAME = 'member-verification';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * Not pure like document-checking's checkCase — this one makes the external IAS call, so
 * it's an async I/O step, not a dry-run-able pure function. The dev preview endpoint calls
 * this same function directly and just skips persistOutcome, same spirit as
 * claim-recognition's preview (real external call, no persistence).
 */
async function checkCase(caseRecord) {
  const extractedFields = caseRecord.extractedFields;
  if (!extractedFields) {
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached DOCUMENT_CHECKED without extraction data)`);
  }

  const memberNrc = extractedFields.claimant?.claimant_nrc_passport;
  const meplEffDate = extractedFields.claim?.accident_date?.replaceAll('-', '');
  if (!memberNrc || !meplEffDate) {
    throw new Error(`Case ${caseRecord.id} is missing claimant_nrc_passport or accident_date needed for IAS lookup`);
  }

  const iasResponse = await getMemberInfo({ memberNrc, meplEffDate });
  const result = evaluate(extractedFields, iasResponse);

  return { caseId: caseRecord.id, outcome: result.outcome, result, iasResponse };
}

async function queueCompleteAckEmail(transaction, caseId) {
  await queueDedupedTask(transaction, { caseId, taskType: 'DOCUMENT_COMPLETE_ACK', dedupeKey: null, payload: {} });
}

/**
 * Maps each MEMBER_REVIEW_REQUIRED reasonCode to the ISSUES line it queues on its own
 * MEMBER_VERIFY_ISSUE email/task (email-sender/templates.js) — not document-checking's
 * MISSING_DOCUMENTS, which frames things as "please resubmit documents" and doesn't fit a
 * details-mismatch/not-found outcome. No separate internal-review path right now (a
 * deliberate simplification: all four reasonCodes get a customer email for now, not just
 * BANK_DETAILS_MISMATCH). See checklist.js's header comment for which of these lines are
 * approved canned wording vs. placeholder.
 */
const REASON_CODE_TO_ISSUE = {
  MEMBER_NOT_FOUND: ISSUES.MEMBER_NOT_VERIFIED,
  COVERAGE_NOT_ACTIVE: ISSUES.POLICY_NOT_ACTIVE_ON_TREATMENT_DATE,
  MEMBER_DETAILS_MISMATCH: ISSUES.INCORRECT_PATIENT_DETAILS,
  BANK_DETAILS_MISMATCH: ISSUES.INCORRECT_BANK_DETAILS,
};

async function queueReviewRequiredEmail(transaction, caseId, reasonCode) {
  const issue = REASON_CODE_TO_ISSUE[reasonCode];
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'MEMBER_VERIFY_ISSUE',
    dedupeKey: issue,
    payload: { issues: [issue] },
  });
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      {
        currentStatus: outcome.outcome,
        memberVerifyResult: outcome.result,
        iasMemberInfoResponse: outcome.iasResponse,
      },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: outcome.outcome,
      reasonCode: outcome.result.reasonCode,
      message: outcome.result.reasonCode || 'Member and coverage verified',
    });

    if (outcome.outcome === 'MEMBER_VERIFIED') {
      await queueCompleteAckEmail(transaction, caseRecord.id);
    } else {
      await queueReviewRequiredEmail(transaction, caseRecord.id, outcome.result.reasonCode);
    }
  });
}

async function run() {
  // Includes MEMBER_REVIEW_REQUIRED alongside DOCUMENT_CHECKED — "recovery": a case that
  // only failed because of stale/lagging IAS data (or a since-corrected record) gets
  // re-evaluated on a later run instead of staying stuck until someone manually resets it
  // via /api/dev/cases/reset. Ordered by updatedAt (not createdAt) so a backlog of
  // still-failing retries doesn't starve freshly-DOCUMENT_CHECKED cases of batch slots —
  // every run, the least-recently-touched cases go first regardless of which bucket they're
  // in. No retry cap/backoff for now — re-checked every run indefinitely; revisit if that
  // proves wasteful against a real IAS environment.
  const cases = await Case.findAll({
    where: { currentStatus: { [Sequelize.Op.in]: ['DOCUMENT_CHECKED', 'MEMBER_REVIEW_REQUIRED'] } },
    limit: config.memberVerification.batchLimit,
    order: [['updatedAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await checkCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true, outcome: outcome.outcome });
    } catch (error) {
      // Technical failure (IAS timeout/error, missing fields) — case is left at whichever
      // status it already had (DOCUMENT_CHECKED or MEMBER_REVIEW_REQUIRED) and retried on
      // the next run, same pattern as document-checking's per-case try/catch.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase };
