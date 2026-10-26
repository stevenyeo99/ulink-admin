const { sequelize, Sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getMemberInfo } = require('./iasClient');
const { evaluate } = require('./checks');
const { checkExclusions } = require('./exclusionFlags');
const { checkBenefitEligibility } = require('./benefitEligibility');
const { checkMemberBalance, balanceIssue } = require('./memberBalance');
const { checkMemberExclusions } = require('./memberExclusion');
const { lastReadSettings } = require('../settings/settings');
const { switchedOff, offNote } = require('../ai-checklist/switches');
const { CHECKS } = require('../ai-checklist/catalog');

// A member check's comparison in checks.hard (a switched-off check's is dropped, so it never reads as a match).
const HARD_CHECK_OF = { 'member:dob': 'dobMatch', 'member:policy': 'policyNoMatch' };
const { queueDedupedTask } = require('../shared/emailTaskQueue');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { caseBasics } = require('../assessment-summary/journey');
const { forCase } = require('../llm-calls/log');

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
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached RECOGNIZED without extraction data)`);
  }

  const memberNrc = extractedFields.claimant?.claimant_nrc_passport;
  // accident_date is only populated for an actual accident/injury claim — an illness
  // reimbursement claim (the common case, e.g. an outpatient visit for a cold) genuinely has
  // no accident, so it's null there and appointment_date (the real visit date) is what
  // exists instead. Falling back to it here is what unblocks those cases from being stuck at
  // RECOGNIZED forever (confirmed 2026-08-26, case 3db18419-6e79-4cb4-b45e-82393926e80c
  // — a routine outpatient claim, never had an accident_date to begin with). An
  // accident/injury claim still prefers its own accident_date, unchanged.
  const treatmentDate = extractedFields.claim?.accident_date || extractedFields.claim?.appointment_date;
  const meplEffDate = treatmentDate?.replaceAll('-', '');
  if (!memberNrc || !meplEffDate) {
    throw new Error(`Case ${caseRecord.id} is missing claimant_nrc_passport or accident_date/appointment_date needed for IAS lookup`);
  }

  const iasResponse = await getMemberInfo({ memberNrc, meplEffDate });
  // The member's balance for each voucher (SYSTEM_5 member balance): only once IAS knows the member. A short voucher is
  // one more member finding (member:balance), listed after the member's own. The last check's head picks come back
  // with the case (caseRecord.memberVerifyResult), so a case re-checked every run is not picked again.
  const balance = iasResponse?.success === true
    ? await checkMemberBalance(extractedFields, iasResponse, caseRecord.memberVerifyResult?.balance?.picks)
    : null;
  // An unsure head with the holdUnsureBenefit switch on (SYSTEM_5 member balance phase C, both flows): a person chooses it
  // before the balance is judged — member problems first, then the head, then the balance (PRD 4.5).
  // The unsure vouchers' own balance lines wait for the person's head; the sure ones are judged now, with any member
  // problem, so an override at member review never skips a known shortfall.
  const holdUnsure = Boolean(balance?.unsure?.length) && lastReadSettings().holdUnsureBenefit;
  const issue = holdUnsure ? balanceIssue(balance.lines, balance.unsure) : balance?.issue;
  // Member checks a super admin switched off (AI checklist page, SYSTEM_5 phase B): skipped, listed as turned off.
  const off = await switchedOff();
  // The member and policy exclusions in IAS, judged by meaning (SYSTEM_5 member exclusion): a likely match or an unsure
  // answer is one more member finding (member:exclusion). Switched off: no IAS or AI call.
  const exclusions = iasResponse?.success === true && !off.has('member:exclusion')
    ? await checkMemberExclusions(extractedFields, iasResponse, caseRecord.memberVerifyResult?.exclusions)
    : null;
  const extra = [issue, exclusions?.issue].filter(Boolean);
  const result = evaluate(extractedFields, iasResponse, extra, off);
  if (exclusions) result.exclusions = { checked: exclusions.checked, note: exclusions.note, fingerprint: exclusions.fingerprint, events: exclusions.events };
  const memberOff = [...off].filter(([code]) => CHECKS.find((c) => c.code === code)?.section === 'member');
  if (memberOff.length) result.turnedOff = memberOff.map(([code, row]) => ({ code, note: offNote(row) }));
  for (const [code] of memberOff) if (HARD_CHECK_OF[code] && result.checks?.hard) delete result.checks.hard[HARD_CHECK_OF[code]];
  if (holdUnsure && result.outcome === 'MEMBER_VERIFIED') {
    result.outcome = 'BENEFIT_REVIEW';
    result.reasonCode = 'BENEFIT_UNSURE';
    result.reason = `The AI was not sure of the benefit of voucher ${balance.unsure.map((i) => i + 1).join(', ')}: a person chooses it.`;
  }
  const previousPicks = caseRecord.memberVerifyResult?.balance?.picks;
  if (balance) {
    result.balance = { checked: balance.checked, note: balance.note, picks: balance.picks, lines: balance.lines, unsure: balance.unsure || [], candidates: balance.candidates || [] };
  }
  else if (previousPicks) result.balance = { checked: false, note: 'IAS did not find the member.', picks: previousPicks, lines: [] };

  // Only run the exclusion-possibility check (SOP §6.3) and benefit-eligibility check (SOP
  // §6.4) once the hard member/policy checks already pass — a case still failing on e.g. a
  // DOB mismatch will be re-evaluated on a later run anyway (see run()'s retry loop), so
  // spending these now would surface a result JD3 won't see until the case clears those
  // first. checkBenefitEligibility itself is free (no LLM), gated here for the same
  // noise-reduction reason as exclusions, not cost.
  if (result.outcome === 'MEMBER_VERIFIED') {
    const eligibilityFlag = off.has('BENEFIT_NOT_ELIGIBLE') ? null : checkBenefitEligibility(extractedFields, iasResponse.payload?.memberPlans);
    result.flags = [
      ...(off.has('POSSIBLE_EXCLUSION') ? [] : await checkExclusions(extractedFields, caseRecord.recognizedType)),
      ...(eligibilityFlag ? [eligibilityFlag] : []),
    ];
  } else {
    result.flags = [];
  }

  // SOP §6.5 (available benefit balance): the IAS remaining balance per voucher, result.balance above (SYSTEM_5 member
  // balance) — it replaced the plan's filed limits (benefitLimits), which were never a remaining balance.

  return { caseId: caseRecord.id, outcome: result.outcome, result, iasResponse };
}

/**
 * MEMBER_VERIFY_ISSUE is internal-only (SOP §11: "hold and verify/escalate", never a
 * direct customer request — see email-sender/service.js's INTERNAL_ONLY_TASK_TYPES and
 * templates.js's renderMemberVerifyIssue), unlike document-checking's MISSING_DOCUMENTS.
 * So the payload carries the real diagnostic detail (reasonCode + the human-readable
 * `reason` checks.js's evaluate() already computed) for an ops reader, not a customer-safe
 * ISSUES.* line. dedupeKey is the reasonCode itself — a re-check that finds the exact same
 * problem doesn't requeue a duplicate notice.
 */
async function queueReviewRequiredEmail(transaction, caseRecord, result) {
  const caseId = caseRecord.id;
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'MEMBER_VERIFY_ISSUE',
    dedupeKey: result.reasonCode,
    // The AI assessment of what is known so far (the member check) — 17/09 meeting action #7.
    payload: { caseId, reasonCode: result.reasonCode, reason: result.reason, issues: result.issues, assessment: assessmentSummaryText(buildAssessmentSummary({ ...caseBasics(caseRecord), currentStatus: 'MEMBER_REVIEW_REQUIRED', memberVerifyResult: result })) },
  });
}

// checks.js's evaluate() returns the literal outcome 'MEMBER_VERIFIED' on a pass — that
// name describes what this block itself concluded, not the final Case.currentStatus to
// write. Since document-checking now runs after this block (swapped 2026-09-01) and is the
// one that sets the real MEMBER_VERIFIED gate ias-claim-preparation reads, a pass here must
// hand off to READY_FOR_DOCUMENT_CHECKING instead — writing 'MEMBER_VERIFIED' directly
// would let ias-claim-preparation pick the case up before document-checking ever ran it.
const OUTCOME_TO_STATUS = {
  MEMBER_VERIFIED: 'READY_FOR_DOCUMENT_CHECKING',
  MEMBER_REVIEW_REQUIRED: 'MEMBER_REVIEW_REQUIRED',
  // A person chooses an unsure benefit head (SYSTEM_5 member balance phase C). Not re-checked every run: it waits.
  BENEFIT_REVIEW: 'BENEFIT_REVIEW',
};

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const newStatus = OUTCOME_TO_STATUS[outcome.outcome];
    await Case.update(
      {
        currentStatus: newStatus,
        memberVerifyResult: outcome.result,
        iasMemberInfoResponse: outcome.iasResponse,
      },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus,
      reasonCode: outcome.result.reasonCode,
      message: outcome.result.reasonCode || 'Member and coverage verified',
    });

    // No email queued on a pass here — the customer was already acknowledged at claim
    // recognition (DOCUMENT_COMPLETE_ACK, claim-recognition/service.js persistOutcome).
    if (outcome.outcome === 'MEMBER_REVIEW_REQUIRED') {
      await queueReviewRequiredEmail(transaction, caseRecord, outcome.result);
    }
  });
}

async function run() {
  // Includes MEMBER_REVIEW_REQUIRED alongside RECOGNIZED — "recovery": a case that only
  // failed because of stale/lagging IAS data (or a since-corrected record) gets
  // re-evaluated on a later run instead of staying stuck until someone manually resets it
  // via /api/dev/cases/reset. Ordered by updatedAt (not createdAt) so a backlog of
  // still-failing retries doesn't starve freshly-RECOGNIZED cases of batch slots — every
  // run, the least-recently-touched cases go first regardless of which bucket they're in.
  // No retry cap/backoff for now — re-checked every run indefinitely; revisit if that
  // proves wasteful against a real IAS environment.
  const cases = await Case.findAll({
    // BENEFIT_REVIEW too (SYSTEM_5 member balance phase C): still waiting while holdUnsureBenefit is on, on its way once
    // it is off; the saved head picks are reused, so no AI call.
    where: { currentStatus: { [Sequelize.Op.in]: ['RECOGNIZED', 'MEMBER_REVIEW_REQUIRED', 'BENEFIT_REVIEW'] } },
    limit: config.memberVerification.batchLimit,
    order: [['updatedAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await forCase(caseRecord.id, 'member-verification', () => checkCase(caseRecord)); // AI call log: this case
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true, outcome: outcome.outcome });
    } catch (error) {
      // Technical failure (IAS timeout/error, missing fields) — case is left at whichever
      // status it already had (RECOGNIZED or MEMBER_REVIEW_REQUIRED) and retried on the
      // next run, same pattern as document-checking's per-case try/catch.
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase };
