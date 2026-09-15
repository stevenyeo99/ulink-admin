const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { evaluateDocumentChecks, evaluateJudgmentDependentChecks } = require('./checklist');
const { entityMatch, meaningMatch } = require('./identityJudgment');
const { queueDedupedTask } = require('../shared/emailTaskQueue');

const BLOCK_NAME = 'document-checking';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * The 6 SOP §7/§8/§9/§10 judgment comparisons (items 13-18) — independent of each other,
 * so run concurrently rather than one at a time. Each call is null-safe (entityMatch and
 * meaningMatch both return null when either input is null) — a case missing one of these
 * fields just means that one comparison can't be judged, not a failure.
 *
 * diagnosisTreatment (item 18) is a meaningMatch, not entityMatch — "does the medical
 * record support the claim form's stated diagnosis/treatment", not "same entity" — the
 * claim-form side combines the two claim-form fields the same way
 * member-verification/exclusionFlags.js already does for the same fields.
 */
async function runJudgments(fields) {
  const claimDiagnosisText = [fields.medical?.detail_of_illness_injury, fields.medical?.full_description_of_treatment]
    .filter(Boolean)
    .join(' — ') || null;

  const [bankAccountHolder, delegationPayee, patientName, providerName, hospitalName, diagnosisTreatment] = await Promise.all([
    entityMatch(fields.claimant?.claimant_name, fields.bank?.bank_account_name),
    entityMatch(fields.delegation_letter?.authorized_payee_name, fields.bank?.bank_account_name),
    entityMatch(fields.claimant?.claimant_name, fields.medical_record?.patient_name),
    entityMatch(fields.medical?.doctor_name, fields.medical_record?.doctor_name),
    entityMatch(fields.medical?.hospital_or_clinic_name, fields.medical_record?.hospital_or_clinic_name),
    meaningMatch(claimDiagnosisText, fields.medical_record?.diagnosis_or_treatment),
  ]);
  return { bankAccountHolder, delegationPayee, patientName, providerName, hospitalName, diagnosisTreatment };
}

/**
 * No longer pure — makes real LLM calls (the 6 judgments), but only once stage 1 (the
 * deterministic EVALUATORS) already has zero issues. Same cost-gating already used for
 * member-verification's exclusion check: no reason to spend 6 LLM calls judging
 * consistency on a case that's already going to be marked INCOMPLETE for a missing
 * invoice — it'll come back around once the customer replies, and judgment runs then.
 * Still reusable identically by the real job and the dev preview endpoint, same as before.
 */
async function checkCase(caseRecord) {
  if (!caseRecord.extractedFields) {
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached READY_FOR_DOCUMENT_CHECKING without extraction data)`);
  }
  const fields = caseRecord.extractedFields;

  const stage1 = evaluateDocumentChecks(fields);

  let result = stage1;
  if (stage1.issues.length === 0) {
    const judgments = await runJudgments(fields);
    const stage2 = evaluateJudgmentDependentChecks(fields, judgments);
    result = {
      issues: [...stage1.issues, ...stage2.issues],
      details: [...stage1.details, ...stage2.details],
      flags: [...stage1.flags, ...stage2.flags],
      passed: stage1.issues.length + stage2.issues.length === 0,
    };
  }

  const outcome = result.passed ? 'DOCUMENT_CHECKED' : 'INCOMPLETE';
  return { caseId: caseRecord.id, outcome, result };
}

/**
 * Signature of the issue list so a re-check that finds the exact same problems doesn't
 * queue a duplicate email — only an actual change in what's wrong (customer replied with
 * some but not all documents, etc.) queues a fresh one.
 */
function issuesDedupeKey(issues) {
  return [...issues].sort().join('|');
}

async function queueMissingDocumentsEmail(transaction, caseId, result) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'MISSING_DOCUMENTS',
    dedupeKey: issuesDedupeKey(result.issues),
    payload: {
      issues: result.issues.map((issue) => {
        const detail = result.details.find((candidate) => candidate.issue === issue && candidate.reason);
        return detail?.reason ? `${issue}\n  Reason: ${detail.reason}` : issue;
      }),
    },
  });
}

async function queueCompleteAckEmail(transaction, caseId) {
  await queueDedupedTask(transaction, { caseId, taskType: 'DOCUMENT_COMPLETE_ACK', dedupeKey: null, payload: {} });
}

// checkCase()'s own outcome names (DOCUMENT_CHECKED/INCOMPLETE) describe what this block
// itself concluded — kept as-is (dev preview endpoint documents this exact enum, see
// routes/dev/documentChecking.js) and are NOT the Case.currentStatus to write. Since this
// block now runs after member-verification (swapped 2026-09-01) and is the last of the two
// checks, a pass here is what sets the real MEMBER_VERIFIED gate ias-claim-preparation
// reads — not a status named after this block.
const OUTCOME_TO_STATUS = {
  DOCUMENT_CHECKED: 'MEMBER_VERIFIED',
  INCOMPLETE: 'INCOMPLETE',
};

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const newStatus = OUTCOME_TO_STATUS[outcome.outcome];
    await Case.update(
      { currentStatus: newStatus, documentCheckResult: outcome.result },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus,
      reasonCode: outcome.result.passed ? null : 'DOCUMENT_ISSUES_FOUND',
      message: outcome.result.passed ? 'All document checks passed' : outcome.result.issues.join('; '),
    });

    if (outcome.result.passed) {
      // Both checks have now passed (member-verification already passed this case earlier
      // in the same run/an earlier run, or this case wouldn't be at READY_FOR_DOCUMENT_CHECKING) —
      // this block is the final gate now, so it's the one that queues the "complete"
      // acknowledgement. Previously queued by member-verification/service.js; moved here
      // when the step order swapped.
      await queueCompleteAckEmail(transaction, caseRecord.id);
    } else {
      await queueMissingDocumentsEmail(transaction, caseRecord.id, outcome.result);
    }
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'READY_FOR_DOCUMENT_CHECKING' },
    limit: config.documentChecking.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await checkCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true, outcome: outcome.outcome });
    } catch (error) {
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase };
