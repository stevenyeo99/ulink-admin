const { sequelize, Case, CaseEvent, AiFeedback } = require('../../db/models');
const config = require('../../config');
const { evaluateDocumentChecks, evaluateJudgmentDependentChecks, vitaminCheck, documentListCheck, benefitTypeCheck, documentDatesCheck, formatCheck, fieldsReadCheck } = require('./checklist');
const { applyVerdicts, correctionHold } = require('../ai-feedback/corrections');
const { withConfirmedValues, withConfirmedChecks } = require('../ai-feedback/confirmations');
const { entityMatch } = require('./identityJudgment');
const { queueDedupedTask } = require('../shared/emailTaskQueue');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { overridesFromEvents } = require('../case-override/override');
const { getSettings } = require('../settings/settings');
const { unsureDocumentPoints, unsurePassedPoints } = require('./holdForReview');
const { forCase } = require('../llm-calls/log');
const { openRequests, withRequests, requestHold, requestedDedupeKey } = require('../case-requests/requests');

const BLOCK_NAME = 'document-checking';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * The 7 judgment comparisons (SOP §7/§8/§9/§10 items 13-18, plus the invoice name, 2026-10-26) — independent of each other,
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

  const [bankAccountHolder, delegationPayee, patientName, hospitalName, invoiceName] = await Promise.all([
    entityMatch(fields.claimant?.claimant_name, fields.bank?.bank_account_name),
    entityMatch(fields.delegation_letter?.authorized_payee_name, fields.bank?.bank_account_name),
    entityMatch(fields.claimant?.claimant_name, fields.medical_record?.patient_name),
    entityMatch(fields.medical?.hospital_or_clinic_name, fields.medical_record?.hospital_or_clinic_name),
    judgeInvoiceNames(fields),
  ]);
  const providerName = null;
  const diagnosisTreatment = null;
  return { bankAccountHolder, delegationPayee, patientName, providerName, hospitalName, diagnosisTreatment, invoiceName };
}

/**
 * Claim form claimant name vs the patient name on each voucher (owner, 2026-10-26): one entityMatch per different name,
 * vouchers with no name left out. Any mismatch fails, naming its voucher(s). Null — no AI call — on a claim for a child
 * (the voucher can name the child, the form the parent: checklist.js shows why) or when there is nothing to compare.
 */
async function judgeInvoiceNames(fields, match = entityMatch) {
  const claimant = fields.claimant?.claimant_name;
  if (!claimant || fields.claimant?.is_claim_for_child === true) return null;
  // Grouped with capitals and spaces ignored: "ZAYAR TUN" and "Zayar  Tun" are one name, one call. The first spelling read is the one compared.
  const byName = new Map();
  // patient_names_read: every name two reads of one voucher gave (claim-recognition mergeInvoiceItemPair).
  (fields.invoices?.items || []).forEach((item, i) => {
    for (const read of item?.patient_names_read || [item?.patient_name]) {
      const name = typeof read === 'string' ? read.trim() : '';
      if (!name) continue;
      const key = name.toLowerCase().replace(/\s+/g, ' ');
      const group = byName.get(key) || { name, vouchers: [] };
      if (!group.vouchers.includes(i + 1)) byName.set(key, { ...group, vouchers: [...group.vouchers, i + 1] });
    }
  });
  const results = (await Promise.all([...byName.values()].map(async ({ name, vouchers }) => ({ vouchers, judgment: await match(claimant, name) }))))
    .filter((r) => r.judgment);
  if (!results.length) return null;
  const failed = results.filter((r) => r.judgment.consistent === false);
  const shown = failed.length ? failed : results;
  return {
    consistent: !failed.length,
    confidence: Math.min(...shown.map((r) => r.judgment.confidence ?? 1)),
    reason: shown.map((r) => `Voucher ${r.vouchers.join(', ')}: ${r.judgment.reason}`).join(' '),
  };
}

/**
 * Not pure — makes real LLM calls (the 7 judgments) — always, regardless of whether stage 1
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
 * which is exactly the one this fix needs to run. Since 2026-10-26 the invoice name (judgeInvoiceNames) also costs one
 * call per different voucher patient name on every check, vouchers or not complete. Still reusable identically by the real job
 * and the dev preview endpoint.
 */
async function checkCase(caseRecord) {
  if (!caseRecord.extractedFields) {
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached READY_FOR_DOCUMENT_CHECKING without extraction data)`);
  }
  await getSettings(); // the AI confidence threshold decides which values read count as unsure (SYSTEM_4 E3b)
  // "✓ Right" (ai-feedback/confirmations.js): a value or check result a person confirmed, still the same, counts as sure.
  const confirmations = await AiFeedback.findAll({ where: { caseId: caseRecord.id, kind: 'confirm' } });
  const fields = withConfirmedValues(caseRecord.extractedFields, confirmations);

  const stage1 = evaluateDocumentChecks(fields);
  const documentList = documentListCheck(fields);
  const judgments = await runJudgments(fields);
  const stage2 = evaluateJudgmentDependentChecks(fields, judgments);
  // A check's verdict a person corrected (SYSTEM_4 E4-12) replaces the AI's; corrected values are already in fields.
  const result = withConfirmedChecks(applyVerdicts({
    issues: [...stage1.issues, ...stage2.issues],
    details: [...stage1.details, ...stage2.details],
    flags: [...stage1.flags, ...stage2.flags],
    passed: stage1.issues.length + stage2.issues.length === 0,
    // + the vitamins / supplements line (SYSTEM_4 E4-10), the format checks on values read and how sure the AI was of
    // them (E4-08), the documents found (kind and date per page), the benefit type they show and whether the medical ones
    // are dated — information for STP and
    // the reviewer, never an issue.
    checklist: [...stage1.checklist, ...stage2.checklist, ...[vitaminCheck(fields), documentList, benefitTypeCheck(fields, documentList), documentDatesCheck(fields, documentList), formatCheck(fields), fieldsReadCheck(fields, stage1.checklist)].filter(Boolean)],
  }, fields.corrections), confirmations);

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

// The customer email's list (both flows, and the email draft — E4-29): the missing items in their approved wording only,
// as the ULINK staff write them (owner, 2026-10-19). The check's reasons stay for the reviewer — on the case page, in
// the team emails and the IAS remark — because they name internal pages and files (they were in the customer list
// from the 17/09 meeting, action 4, until then).
function missingDocumentItems(result) {
  return [...result.issues];
}

async function queueMissingDocumentsEmail(transaction, caseId, result) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'MISSING_DOCUMENTS',
    dedupeKey: issuesDedupeKey(result.issues),
    payload: { issues: missingDocumentItems(result) },
  });
}

// Internal copy (17/09 meeting notes, item 4): the team sees which documents the customer was asked
// for and why the case went this way, without opening the console. Same dedupe key as the customer
// email, so the team hears about the same missing list once.
// held: the AI's unsure points when the customer email is held for review (else null). requested: a reviewer's own
// lines (SYSTEM_4 E4-28) — the team contacts the customer about them; part of the dedupe key, so a new list is sent.
async function queueDocumentsIncompleteEmail(transaction, caseRecord, result, { status = 'INCOMPLETE', held = null, requested = null } = {}) {
  const events = await CaseEvent.findAll({ where: { caseId: caseRecord.id, reasonCode: 'MANUAL_OVERRIDE' }, transaction });
  const fields = { ...(caseRecord.toJSON ? caseRecord.toJSON() : caseRecord), currentStatus: status, documentCheckResult: result };
  await queueDedupedTask(transaction, {
    caseId: caseRecord.id,
    taskType: 'DOCUMENTS_INCOMPLETE',
    dedupeKey: requested ? requestedDedupeKey(requested, result.issues) : issuesDedupeKey(result.issues),
    payload: {
      caseId: caseRecord.id,
      issues: result.issues,
      held,
      ...(requested ? { requested } : {}),
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

async function persistOutcome(caseRecord, rawOutcome) {
  // A reviewer's own lines (SYSTEM_4 E4-28) go on the result; open ones hold a pass for a person whatever the switch.
  const outcome = { ...rawOutcome, result: withRequests(rawOutcome.result, await openRequests(caseRecord.id)) };
  const requested = requestHold(outcome.result);
  // Missing documents the AI wasn't sure about wait for a person before the customer is emailed —
  // only with the switch on (settings.holdUnsureMissingDocsEmail); off, exactly as before.
  // After a person corrected items (SYSTEM_4 E4-12): held for them whatever the switch — they send the request.
  const corrected = correctionHold(outcome.result, caseRecord.extractedFields);
  const unsure = [
    ...(outcome.result.passed || !(await getSettings()).holdUnsureMissingDocsEmail ? [] : unsureDocumentPoints(outcome.result)),
    ...corrected,
  ];
  const held = unsure.length > 0;
  // Passed, but the AI was unsure about an item: a person confirms before claim preparation — only with the switch on
  // (settings.holdUnsureDocumentPass, SYSTEM_4 E4-09).
  const unsurePassed = outcome.result.passed ? unsurePassedPoints(outcome.result) : [];
  const confirm = requested.length > 0 || (unsurePassed.length > 0 && (await getSettings()).holdUnsureDocumentPass);
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const newStatus = held ? 'DOCUMENTS_REVIEW' : confirm ? 'DOCUMENTS_UNSURE' : OUTCOME_TO_STATUS[outcome.outcome];
    await Case.update(
      { currentStatus: newStatus, documentCheckResult: outcome.result },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus,
      reasonCode: outcome.result.passed ? null : 'DOCUMENT_ISSUES_FOUND',
      message: outcome.result.passed
        ? `All document checks passed${requested.length ? ` — a person checks the requested lines first: ${requested.join('; ')}`
          : confirm ? ` — a person confirms first: the AI was unsure about ${unsurePassed.join('; ')}` : ''}`
        : `${outcome.result.issues.join('; ')}${held ? ` — customer email held for a person: ${unsure.join('; ')}` : ''}`,
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
      const outcome = await forCase(caseRecord.id, 'document-checking', () => checkCase(caseRecord)); // AI call log: this case
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
// if nothing moved the case meanwhile. operator: who, comment: why (SYSTEM_4 E4-11) — both for the case history.
async function releaseMissingDocumentsEmail(caseRecord, operator, comment = null) {
  return sequelize.transaction(async (transaction) => {
    const [moved] = await Case.update({ currentStatus: 'INCOMPLETE' }, { where: { id: caseRecord.id, currentStatus: 'DOCUMENTS_REVIEW' }, transaction });
    if (moved !== 1) return false;
    await logEvent(transaction, { caseId: caseRecord.id, prevStatus: 'DOCUMENTS_REVIEW', newStatus: 'INCOMPLETE', reasonCode: 'MISSING_DOCUMENTS_RELEASED', message: `Missing-documents email sent to the customer by ${operator} after review${comment ? ` — comment: ${comment}` : ''}` });
    await queueMissingDocumentsEmail(transaction, caseRecord.id, caseRecord.documentCheckResult);
    return true;
  });
}

module.exports = { run, checkCase, judgeInvoiceNames, persistOutcome, releaseMissingDocumentsEmail, issuesDedupeKey, missingDocumentItems, queueMissingDocumentsEmail, queueDocumentsIncompleteEmail };
