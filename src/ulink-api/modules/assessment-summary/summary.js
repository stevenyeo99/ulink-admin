// assessment-summary: the AI claim-assessment summary (docs/imp/demo/API DAY1/PREV_FEEDBACK/SUMMARY_REQUIREMENT.md).
//
// Turns the results a case already has into an explanation trail: for each decision the system or the
// AI made — what it decided, why, how sure, how that was verified — and, where a person should look,
// why (review reason) and who might be wrong. Built by rules from stored results only: no LLM call, no
// DB access, no side effects, so it is safe to call from anywhere (console, emails, review queue).
//
// Input: case fields as the email flow stores them on ulink_cases — memberVerifyResult,
// documentCheckResult, claimPrepMeta, isStp. API cases pass apiCaseView(steps) (api-pipeline/caseView.js),
// which maps their step outputs onto the same names. Any field may be missing (a case part-way through).

// Same 0.5 every confidence-gated judge uses (identityJudgment, diagnosisPicker, benefitPicker,
// policy-exclusion judge) and the console's ConfidenceSummary.
const LOW_CONFIDENCE = 0.5;

// How a result was reached — how far a reviewer can trust it on its own.
const VERIFIED = {
  RULE: 'Rule',                    // plain comparison / calculation
  CROSS_CHECK: 'Cross-checked',    // AI reading agrees with an independent source (IAS, another page, a sum)
  AI: 'AI self-rated',             // only the model's own confidence — a hint, not proof
};

// Why a person should look, who might be wrong, and what to check first.
const REVIEW = {
  AI_UNSURE: { reason: 'AI unsure', mightBeWrong: ['AI judgment'], check: "Check the AI's result against the documents." },
  UNREADABLE: { reason: 'Unreadable', mightBeWrong: ['AI vision', 'Customer'], check: 'Look at the document image yourself.' },
  DATA_MISMATCH: { reason: 'Data mismatch', mightBeWrong: ['Customer', 'AI vision', 'IAS record'], check: 'Compare the document, IAS and the customer; decide which is right.' },
  MISSING: { reason: 'Missing information', mightBeWrong: ['Customer', 'AI vision'], check: 'Confirm it is really missing, then ask the customer.' },
  RULE_HOLD: { reason: 'Rule hold', mightBeWrong: [], check: 'Apply the policy rule.' },
};

const MEMBER_REVIEW = {
  COVERAGE_NOT_ACTIVE: REVIEW.RULE_HOLD,
  MEMBER_NOT_FOUND: REVIEW.DATA_MISMATCH,
  MEMBER_DETAILS_MISMATCH: REVIEW.DATA_MISMATCH,
  BANK_DETAILS_MISMATCH: REVIEW.DATA_MISMATCH,
};

const MEMBER_CHECK_LABELS = {
  coverageActive: 'coverage active',
  dobMatch: 'date of birth',
  bankNameMatch: 'bank name',
  bankAccountNameMatch: 'bank account name',
  bankAccountNumberMatch: 'bank account number',
  policyNoMatch: 'policy number',
};

// Document checks whose confidence comes from agreement between two readings, not the model's own score.
const CROSS_CHECKED_DOCUMENT_CODES = new Set(['VOUCHER_AMOUNT_MISMATCH', 'TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT']);

// A failed document check: what kind of problem it is.
const DOCUMENT_REVIEW = {
  INCOMPLETE_MEDICAL_REPORT: REVIEW.UNREADABLE,
  UNCLEAR_VOUCHER: REVIEW.UNREADABLE,
  MISSING_VOUCHER: REVIEW.MISSING,
  NO_MEDICAL_REPORT: REVIEW.MISSING,
  MISSING_BANK_INFO: REVIEW.MISSING,
  INCOMPLETE_CLAIM_FORM: REVIEW.MISSING,
  MISSING_VOUCHER_BREAKDOWN: REVIEW.MISSING,
  MISSING_MANDATORY_FIELD: REVIEW.MISSING,
};

// The checklist's own reasons for these are written for developers ("medical_record.legible is false").
const PLAIN_DOCUMENT_REASONS = {
  MISSING_VOUCHER: 'No voucher or invoice was found in the submitted documents.',
  NO_MEDICAL_REPORT: 'No medical record was found in the submitted documents.',
  INCOMPLETE_MEDICAL_REPORT: 'A medical record was found but could not be read clearly.',
  MISSING_BANK_INFO: 'Bank name, account name and account number are all missing.',
};

// The checklist's labels name the problem ("… does not appear to match …"); a reviewer reads a decision,
// so each check gets a neutral name. Unknown codes fall back to the checklist label.
const DOCUMENT_DECISIONS = {
  INCOMPLETE_CLAIM_FORM: 'Claim form complete (diagnosis in section B)',
  MISSING_VOUCHER: 'Voucher present',
  NO_MEDICAL_REPORT: 'Medical record present',
  UNCLEAR_VOUCHER: 'Voucher readable',
  INCORRECT_VOUCHER: 'Voucher correct',
  MISSING_VOUCHER_BREAKDOWN: 'Pharmacy breakdown on voucher',
  VOUCHER_AMOUNT_MISMATCH: 'Voucher amount matches claimed amount',
  INCOMPLETE_MEDICAL_REPORT: 'Medical record readable',
  MISSING_BANK_INFO: 'Bank information present',
  TREATMENT_DATE_INCONSISTENT: 'Treatment date matches medical record',
  INVOICE_DATE_INCONSISTENT: 'Invoice date matches medical record',
  DELEGATION_LETTER_REQUIRED: 'Bank account holder is the claimant (or delegation letter)',
  DELEGATION_PAYEE_INCONSISTENT: 'Delegation letter payee matches bank account holder',
  PATIENT_NAME_INCONSISTENT: 'Claimant name matches medical record',
  PROVIDER_NAME_INCONSISTENT: 'Doctor name matches medical record',
  HOSPITAL_NAME_INCONSISTENT: 'Hospital/clinic name matches medical record',
  DIAGNOSIS_TREATMENT_INCONSISTENT: 'Medical record supports diagnosis/treatment',
};

const NOT_RECORDED = 'Reason not recorded';

const amount = (value) => Number(value).toLocaleString('en-US');

function formatConfidence(confidence) {
  return confidence == null ? null : Number(confidence).toFixed(2);
}

function line({ decision, result, status, why, confidence = null, verified, review = null }) {
  return { decision, result, status, why: why || NOT_RECORDED, confidence, verified, review };
}

// A result the AI rated below the threshold is worth a look even when it passed.
function lowConfidenceReview(confidence) {
  return confidence != null && confidence < LOW_CONFIDENCE ? REVIEW.AI_UNSURE : null;
}

function memberLines(memberVerifyResult) {
  if (!memberVerifyResult) return [];
  const { outcome, reasonCode, reason, checks, flags } = memberVerifyResult;
  const hard = checks?.hard || {};
  const labelsWhere = (value) => Object.keys(MEMBER_CHECK_LABELS).filter((key) => hard[key] === value).map((key) => MEMBER_CHECK_LABELS[key]);

  const lines = [];
  if (outcome === 'MEMBER_VERIFIED') {
    const matched = labelsWhere(true);
    const notChecked = labelsWhere(null);
    lines.push(line({
      decision: 'Member check',
      result: 'Verified',
      status: 'ok',
      why: [
        matched.length ? `Matches IAS: ${matched.join(', ')}.` : null,
        notChecked.length ? `Not compared (no value to compare): ${notChecked.join(', ')}.` : null,
      ].filter(Boolean).join(' '),
      verified: VERIFIED.CROSS_CHECK,
    }));
  } else if (outcome) {
    lines.push(line({
      decision: 'Member check',
      result: reasonCode || outcome,
      status: 'issue',
      why: reason,
      verified: VERIFIED.CROSS_CHECK,
      review: MEMBER_REVIEW[reasonCode] || REVIEW.DATA_MISMATCH,
    }));
  }

  // Advisory flags on a verified member: benefit eligibility (rule) and possible policy exclusion (AI).
  for (const flag of flags || []) {
    const byAi = flag.confidence != null;
    lines.push(line({
      decision: flag.code === 'POSSIBLE_EXCLUSION' ? 'Policy exclusion' : 'Benefit eligibility',
      result: flag.code,
      status: 'issue',
      why: flag.reason || flag.desc || (flag.clauseRef ? `Possible match with exclusion clause ${flag.clauseRef}.` : null),
      confidence: formatConfidence(flag.confidence),
      verified: byAi ? VERIFIED.AI : VERIFIED.RULE,
      review: byAi ? { ...REVIEW.RULE_HOLD, mightBeWrong: ['AI judgment'] } : REVIEW.RULE_HOLD,
    }));
  }
  return lines;
}

function documentLines(documentCheckResult) {
  if (!documentCheckResult) return [];
  const { checklist = [], details = [] } = documentCheckResult;
  const reasonFor = (code) => PLAIN_DOCUMENT_REASONS[code] || details.find((d) => d.code === code && d.reason)?.reason;

  const lines = [];
  // The 20-odd mandatory-field checks collapse into one line: only the missing ones matter to a reviewer.
  const mandatory = checklist.filter((item) => item.code === 'MISSING_MANDATORY_FIELD');
  if (mandatory.length) {
    const missing = mandatory.filter((item) => item.passed === false).map((item) => item.label);
    lines.push(line({
      decision: 'Mandatory fields',
      result: missing.length ? `${missing.length} missing` : 'All present',
      status: missing.length ? 'issue' : 'ok',
      why: missing.length ? `Not found in the submitted documents: ${missing.join('; ')}.` : `All ${mandatory.length} required fields were found.`,
      verified: VERIFIED.RULE,
      review: missing.length ? REVIEW.MISSING : null,
    }));
  }

  // Passed checks with nothing to explain, and checks with nothing to compare, each collapse into one line.
  const quietlyPassed = [];
  const notChecked = [];
  for (const item of checklist) {
    if (item.code === 'MISSING_MANDATORY_FIELD') continue;
    const decision = DOCUMENT_DECISIONS[item.code] || item.label;
    if (item.passed === null || item.passed === undefined) {
      notChecked.push(decision);
      continue;
    }
    const failed = item.passed === false;
    if (!failed && !item.note && item.confidence == null) {
      quietlyPassed.push(decision);
      continue;
    }
    lines.push(line({
      decision,
      result: failed ? 'Issue' : 'OK',
      status: failed ? 'issue' : 'ok',
      why: failed ? reasonFor(item.code) || item.note : item.note,
      confidence: formatConfidence(item.confidence),
      verified: CROSS_CHECKED_DOCUMENT_CODES.has(item.code) ? VERIFIED.CROSS_CHECK
        : item.confidence != null ? VERIFIED.AI : VERIFIED.RULE,
      review: failed ? (DOCUMENT_REVIEW[item.code] || REVIEW.DATA_MISMATCH) : lowConfidenceReview(item.confidence),
    }));
  }
  if (quietlyPassed.length) {
    lines.push(line({ decision: 'Other document checks', result: 'OK', status: 'ok', why: `Passed: ${quietlyPassed.join('; ')}.`, verified: VERIFIED.RULE }));
  }
  if (notChecked.length) {
    lines.push(line({
      decision: 'Not checked',
      result: 'Nothing to compare',
      status: 'not_checked',
      why: `No value in the submitted documents to compare for: ${notChecked.join('; ')}.`,
      verified: VERIFIED.RULE,
    }));
  }
  return lines;
}

function preparationLines(claimPrepMeta, isStp) {
  const lines = [];
  const diagnosis = claimPrepMeta?.diagnosis;
  if (diagnosis) {
    const code = diagnosis.pick ? `${diagnosis.pick.diagCode} ${diagnosis.pick.diagDesc || ''}`.trim() : 'None';
    lines.push(line({
      decision: 'Diagnosis code',
      result: diagnosis.defaulted ? `${code} (default)` : code,
      status: diagnosis.defaulted ? 'issue' : 'ok',
      why: diagnosis.defaulted
        ? ['No confident match for the diagnosis text, so the default code was used.', diagnosis.reason && `AI: ${diagnosis.reason}`].filter(Boolean).join(' ')
        : diagnosis.reason,
      confidence: formatConfidence(diagnosis.confidence),
      verified: VERIFIED.AI,
      review: diagnosis.defaulted ? REVIEW.AI_UNSURE : lowConfidenceReview(diagnosis.confidence),
    }));
  }

  (claimPrepMeta?.lines || []).forEach((benefit, i) => {
    const picked = benefit.pick ? `${benefit.pick.benefitType}/${benefit.pick.benefitHead}` : 'None';
    lines.push(line({
      decision: `Benefit (voucher ${i + 1}${benefit.voucherType ? `, ${benefit.voucherType}` : ''})`,
      result: picked,
      status: benefit.pick ? 'ok' : 'issue',
      why: benefit.pick ? benefit.reason
        : ['No benefit could be picked with enough confidence.', benefit.reason && `AI: ${benefit.reason}`].filter(Boolean).join(' '),
      confidence: formatConfidence(benefit.confidence),
      verified: VERIFIED.AI,
      review: benefit.pick ? lowConfidenceReview(benefit.confidence) : REVIEW.AI_UNSURE,
    }));
  });

  if (isStp === true || isStp === false) {
    const stp = claimPrepMeta?.stp;
    lines.push(line({
      decision: 'STP',
      result: isStp ? 'Yes' : 'No',
      status: 'ok',
      why: !stp ? null
        : stp.limit == null ? `No STP limit is configured for this claim type${stp.currency ? ` in ${stp.currency}` : ''}, so it is not STP.`
          : `Claimed ${amount(stp.total)} ${stp.currency || ''} ${isStp ? '≤' : '>'} limit ${amount(stp.limit)}`.replace(/\s+/g, ' ').trim(),
      verified: VERIFIED.RULE,
    }));
  }
  return lines;
}

/**
 * Builds the explanation trail for one case.
 * Returns { lines, reviewPoints, needsReview }; each line is
 * { decision, result, status: ok|issue|not_checked, why, confidence, verified, review: { reason, mightBeWrong, check } | null }.
 */
function buildAssessmentSummary(fields = {}) {
  // area: which check a line came from — lets a manual override of that check (modules/case-override)
  // mark its points as dealt with, e.g. so the Review Queue doesn't raise them again.
  const withArea = (area, lines) => lines.map((l) => ({ ...l, area }));
  const lines = [
    ...withArea('member', memberLines(fields.memberVerifyResult)),
    ...withArea('documents', documentLines(fields.documentCheckResult)),
    ...withArea('claim', preparationLines(fields.claimPrepMeta, fields.isStp)),
  ];
  const reviewPoints = lines.filter((l) => l.review).map((l) => ({ decision: l.decision, area: l.area, ...l.review }));

  // An automatically approved claim that still has open points is exactly what a reviewer should see first.
  if (fields.isStp === true && reviewPoints.length) {
    reviewPoints.unshift({
      decision: 'STP',
      area: 'claim',
      reason: 'STP with open review points',
      mightBeWrong: ['AI judgment'],
      check: 'This claim went straight through; confirm the points below were right.',
    });
  }
  return { lines, reviewPoints, needsReview: reviewPoints.length > 0 };
}

// Plain text for emails and logs. Review points first — what a reader should check before anything else.
function assessmentSummaryText(summary) {
  if (!summary.lines.length) return 'No assessment yet.';
  const next = summary.reviewPoints.length
    ? `Next review points:\n${summary.reviewPoints.map((p, i) => `${i + 1}. ${p.decision} — ${p.check}`).join('\n')}`
    : 'No review points.';
  const body = summary.lines.map((l, i) => {
    const how = [l.verified, l.confidence != null ? `confidence ${l.confidence}` : null].filter(Boolean).join(', ');
    const review = l.review
      ? `\n   Review: ${l.review.reason}${l.review.mightBeWrong.length ? ` (might be wrong: ${l.review.mightBeWrong.join(', ')})` : ''}`
      : '';
    return `${i + 1}. ${l.decision}: ${l.result}\n   Why: ${l.why}\n   How: ${how}${review}`;
  }).join('\n');
  return `${next}\n\nDecisions:\n${body}`;
}

module.exports = { buildAssessmentSummary, assessmentSummaryText, LOW_CONFIDENCE };
