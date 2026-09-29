const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { evaluateDocumentChecks, evaluateJudgmentDependentChecks } = require('./checklist');
const { entityMatch } = require('./identityJudgment');
const { queueDedupedTask } = require('../shared/emailTaskQueue');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { overridesFromEvents } = require('../case-override/override');
const { getSettings } = require('../settings/settings');
const { unsureDocumentPoints } = require('./holdForReview');

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
 *
 * providerName and diagnosisTreatment are deliberately NOT called (left null below) — the
 * same deadline-driven call checklist.js's own comment already documents for
 * patientName/providerName under the old identity_consistency scheme (2026-08-22): "produced
 * enough false positives on known-complete samples (complete/1, complete/2) that it's not
 * worth the remaining time to harden before ship." Re-verified 2026-09-16 against those exact
 * same two samples under the current entityMatch-based implementation, reproducing the same
 * failure: Moe Thida (DAY1/complete/2) and Hsu Myat Pyae (20260826/complete/2) both flagged
 * providerName inconsistent on real, complete claims (confidence 0.85-0.9, genuinely
 * different-sounding names — not a low-confidence near-miss), and Moe Thida also flagged
 * diagnosisTreatment inconsistent the same run. The revival on 2026-09-14 was never
 * re-validated against this same sample set before shipping. Re-enable both only after a
 * proper accuracy pass against real samples, same condition the original disabling comment
 * set (see checklist.js's own "Re-enable... once there's time to revisit reliability").
 * patientName and hospitalName are left running — narrower evidence against them so far.
 */
async function runJudgments(fields) {
  const claimDiagnosisText = [fields.medical?.detail_of_illness_injury, fields.medical?.full_description_of_treatment]
    .filter(Boolean)
    .join(' — ') || null;

  const [bankAccountHolder, delegationPayee, patientName, hospitalName] = await Promise.all([
    entityMatch(fields.claimant?.claimant_name, fields.bank?.bank_account_name),
    entityMatch(fields.delegation_letter?.authorized_payee_name, fields.bank?.bank_account_name),
    entityMatch(fields.claimant?.claimant_name, fields.medical_record?.patient_name),
    entityMatch(fields.medical?.hospital_or_clinic_name, fields.medical_record?.hospital_or_clinic_name),
  ]);
  const providerName = null;
  const diagnosisTreatment = null;
  return { bankAccountHolder, delegationPayee, patientName, providerName, hospitalName, diagnosisTreatment };
}

/**
 * Not pure — makes real LLM calls (the 6 judgments) — always, regardless of whether stage 1
 * (the deterministic EVALUATORS) already found an issue. Previously gated on stage1.issues
 * being empty, on the assumption that a case already going to be marked INCOMPLETE didn't
 * need judgment run yet — reverted 2026-09-16 (case e5498fa0-28d3-46da-9d61-a4adb16b92f2 /
 * 6685636e-9fec-4df5-bb36-ac9eb1af53ba) after checking the real reference reply for this
 * exact submission (docs/imp/demo/20260914/samples/3/3_email_real_user_check_reply.md): the
 * actual human reviewer sent BOTH "Need medical record" and the delegation-letter request in
 * one email, not staged across two round trips. Cost impact is small in practice —
 * entityMatch is null-safe (see runJudgments above, which as of 2026-09-16 only actually
 * calls it for patientName/hospitalName — providerName/diagnosisTreatment are disabled, see
 * that function's own comment) and those two short-circuit to null for free whenever
 * medical_record isn't present, since their inputs are null too; only bankAccountHolder
 * (medical_record-independent) reliably costs a real call on an otherwise-incomplete case,
 * which is exactly the one this fix needs to run. Still reusable identically by the real job
 * and the dev preview endpoint.
 */
async function checkCase(caseRecord) {
  if (!caseRecord.extractedFields) {
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached READY_FOR_DOCUMENT_CHECKING without extraction data)`);
  }
  const fields = caseRecord.extractedFields;

  const stage1 = evaluateDocumentChecks(fields);
  const judgments = await runJudgments(fields);
  const stage2 = evaluateJudgmentDependentChecks(fields, judgments);
  const result = {
    issues: [...stage1.issues, ...stage2.issues],
    details: [...stage1.details, ...stage2.details],
    flags: [...stage1.flags, ...stage2.flags],
    passed: stage1.issues.length + stage2.issues.length === 0,
    checklist: [...stage1.checklist, ...stage2.checklist],
  };

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

// Internal copy (17/09 meeting notes, item 4): the team sees which documents the customer was asked
// for and why the case went this way, without opening the console. Same dedupe key as the customer
// email, so the team hears about the same missing list once.
// held: the AI's unsure points when the customer email is held for review (else null).
async function queueDocumentsIncompleteEmail(transaction, caseRecord, result, { status = 'INCOMPLETE', held = null } = {}) {
  const events = await CaseEvent.findAll({ where: { caseId: caseRecord.id, reasonCode: 'MANUAL_OVERRIDE' }, transaction });
  const fields = { ...(caseRecord.toJSON ? caseRecord.toJSON() : caseRecord), currentStatus: status, documentCheckResult: result };
  await queueDedupedTask(transaction, {
    caseId: caseRecord.id,
    taskType: 'DOCUMENTS_INCOMPLETE',
    dedupeKey: issuesDedupeKey(result.issues),
    payload: {
      caseId: caseRecord.id,
      issues: result.issues,
      held,
      assessment: assessmentSummaryText(buildAssessmentSummary(fields, { overrides: overridesFromEvents(events) })),
    },
  });
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
  // Missing documents the AI wasn't sure about wait for a person before the customer is emailed —
  // only with the switch on (settings.holdUnsureMissingDocsEmail); off, exactly as before.
  const unsure = outcome.result.passed ? [] : unsureDocumentPoints(outcome.result);
  const held = unsure.length > 0 && (await getSettings()).holdUnsureMissingDocsEmail;
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const newStatus = held ? 'DOCUMENTS_REVIEW' : OUTCOME_TO_STATUS[outcome.outcome];
    await Case.update(
      { currentStatus: newStatus, documentCheckResult: outcome.result },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus,
      reasonCode: outcome.result.passed ? null : 'DOCUMENT_ISSUES_FOUND',
      message: outcome.result.passed ? 'All document checks passed'
        : `${outcome.result.issues.join('; ')}${held ? ` — customer email held: the AI was unsure (${unsure.join('; ')})` : ''}`,
    });

    // A pass sends nothing: the customer was already acknowledged at claim recognition
    // (17/09 meeting, action 6).
    if (!outcome.result.passed) {
      if (!held) await queueMissingDocumentsEmail(transaction, caseRecord.id, outcome.result);
      await queueDocumentsIncompleteEmail(transaction, caseRecord, outcome.result, { status: newStatus, held: held ? unsure : null });
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

// A person checked a held case and the documents really are missing: send the customer the request
// the check prepared, and move the case to "Documents incomplete". Only from DOCUMENTS_REVIEW, and only
// if nothing moved the case meanwhile. operator: who (for the case history).
async function releaseMissingDocumentsEmail(caseRecord, operator) {
  return sequelize.transaction(async (transaction) => {
    const [moved] = await Case.update({ currentStatus: 'INCOMPLETE' }, { where: { id: caseRecord.id, currentStatus: 'DOCUMENTS_REVIEW' }, transaction });
    if (moved !== 1) return false;
    await logEvent(transaction, { caseId: caseRecord.id, prevStatus: 'DOCUMENTS_REVIEW', newStatus: 'INCOMPLETE', reasonCode: 'MISSING_DOCUMENTS_RELEASED', message: `Missing-documents email sent to the customer by ${operator} after review` });
    await queueMissingDocumentsEmail(transaction, caseRecord.id, caseRecord.documentCheckResult);
    return true;
  });
}

module.exports = { run, checkCase, persistOutcome, releaseMissingDocumentsEmail, issuesDedupeKey };
