/**
 * Pure comparison logic — no I/O. Implements the Hard/Soft field table settled in
 * docs/imp/day1/drt-claim-demo-progress.md's "Member verification" section, plus the
 * confirmed coverage-period rule: treatment date must fall within
 * [NVL(memberPlans[0].REINST_DATE, memberPlans[0].EFF_DATE), NVL(memberPlans[0].TERM_DATE, memberPlans[0].EXP_DATE)].
 *
 * Date conversions live in modules/shared/iasDates.js, not here — two date formats are in
 * play and must not be confused (see that module's own comment), and it's now shared with
 * modules/ias-claim-preparation, which has its own third IAS date format to keep straight.
 */

const { toYYYYMMDD, iasDateToYYYYMMDD } = require('../shared/iasDates');

function norm(value) {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

/**
 * true/false/null (null = can't determine, one or both sides missing) — never guesses.
 */
function compare(extractedValue, iasValue) {
  const a = norm(extractedValue);
  const b = norm(iasValue);
  if (a == null || b == null) return null;
  return a === b;
}

/**
 * Bank names get abbreviated (extracted "AYA" vs IAS's own "AYA bank") in a way exact
 * `compare()` would wrongly flag as a mismatch — unlike account numbers/DOB, dropping a
 * generic suffix word ("bank", "co.", "ltd") doesn't change which real bank is meant.
 * Containment either direction covers both abbreviation directions; this is intentionally
 * looser than compare() and is used for bank_name only — account number/name and DOB stay
 * on exact compare(), where a substring match would be a real, dangerous false positive
 * (e.g. "123" is a substring of a longer real account number).
 */
function compareBankName(extractedValue, iasValue) {
  const a = norm(extractedValue);
  const b = norm(iasValue);
  if (a == null || b == null) return null;
  return a === b || a.includes(b) || b.includes(a);
}

// Burmese and generic English honorific prefixes that legitimately vary between what a
// customer writes and IAS's own stored name (e.g. "U Thiha" vs IAS's own "Thiha" — same
// account holder), stripped as a single leading token before comparing account-holder
// names. Deliberately NOT containment (unlike compareBankName above) — a plain substring
// match on a person's name is a real false-positive risk (e.g. "Thiha" would wrongly match
// "Nay Thiha Aung", a genuinely different person), so this stays an exact compare, just on
// the honorific-stripped form.
const HONORIFIC_PREFIXES = new Set(['u', 'daw', 'ko', 'ma', 'saya', 'sayama', 'mr', 'mrs', 'ms', 'dr']);

function stripHonorific(value) {
  const normalized = norm(value);
  if (normalized == null) return null;
  const [first, ...rest] = normalized.split(' ');
  return rest.length > 0 && HONORIFIC_PREFIXES.has(first.replace(/\.$/, '')) ? rest.join(' ') : normalized;
}

/**
 * Verified against real data (2026-09-16): "U Thiha" (extracted) vs IAS's "Thiha", same
 * account holder, hit this exact false positive twice in a row — see the
 * BANK_DETAILS_MISMATCH thread. Was plain compare() until this fix; see git history for the
 * "Known limitation, accepted as-is" comment this replaced.
 */
function compareAccountHolderName(extractedValue, iasValue) {
  const a = stripHonorific(extractedValue);
  const b = stripHonorific(iasValue);
  if (a == null || b == null) return null;
  return a === b;
}

// SOP §6.1 (Member Active Status) decision, 2026-09-14: checked a real IAS sample
// (docs/imp/day1/IAS/ias_get_member_information_response_v2.json) — both
// memberPlans[0].STATUS and policies[0].STATUS came back null, not a field this system can
// reliably gate on. Business-confirmed equivalent: the coverage-period range this function
// already checks (REINST_DATE/EFF_DATE..TERM_DATE/EXP_DATE) is accepted as the active-status
// check — no separate STATUS-field check is added.
function checkCoverageActive(plan, treatmentDateYYYYMMDD) {
  if (!plan || !treatmentDateYYYYMMDD) return null;
  const start = iasDateToYYYYMMDD(plan.REINST_DATE) || iasDateToYYYYMMDD(plan.EFF_DATE);
  const end = iasDateToYYYYMMDD(plan.TERM_DATE) || iasDateToYYYYMMDD(plan.EXP_DATE);
  if (!start || !end) return null;
  return treatmentDateYYYYMMDD >= start && treatmentDateYYYYMMDD <= end;
}

function evaluate(extractedFields, iasResponse) {
  if (!iasResponse || iasResponse.success !== true) {
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'MEMBER_NOT_FOUND',
      checks: {},
      reason: `IAS member lookup did not return a match${iasResponse?.error ? ` (${iasResponse.error})` : ''}.`,
    };
  }

  const member = iasResponse.payload?.member || {};
  const policies = iasResponse.payload?.policies || [];
  const memberPlans = iasResponse.payload?.memberPlans || [];
  const plan = memberPlans[0] || null;
  const policy = policies[0] || null;

  // Same accident_date -> appointment_date fallback as service.js's IAS lookup key (see its
  // comment) — an illness claim has no accident_date, so the coverage-active check must fall
  // back to the actual visit date too, or it would wrongly treat "no accident" as "can't
  // determine coverage" (checkCoverageActive returns null when its date arg is falsy).
  const treatmentDate = toYYYYMMDD(extractedFields.claim?.accident_date || extractedFields.claim?.appointment_date);
  const coverageActive = checkCoverageActive(plan, treatmentDate);

  const hard = {
    coverageActive,
    dobMatch: compare(toYYYYMMDD(extractedFields.claimant?.claimant_dob), iasDateToYYYYMMDD(member.DOB)),
    bankNameMatch: compareBankName(extractedFields.bank?.bank_name, member.BANK_NAME),
    // Honorific-tolerant compare (see compareAccountHolderName above) — still an exact
    // match once a leading title is stripped, so a genuinely different payee's name still
    // fails this. Remaining known gap: a non-honorific script/transliteration difference
    // (not covered by HONORIFIC_PREFIXES) still false-positives here; revisit with an
    // LLM-judged comparison (document-checking/identityJudgment.js's entityMatch) only if
    // that shows up in practice — deliberately not reached for yet on this payment-safety
    // gate, see the BANK_DETAILS_MISMATCH advisory thread this fix came out of.
    bankAccountNameMatch: compareAccountHolderName(extractedFields.bank?.bank_account_name, member.CL_PAY_ACCT_NAME),
    bankAccountNumberMatch: compare(extractedFields.bank?.bank_account_number, member.CL_PAY_ACCT_NO),
    policyNoMatch: compare(extractedFields.policy?.policy_no, policy?.POCY_REF_NO),
  };

  const soft = {
    claimantName: { extracted: extractedFields.claimant?.claimant_name ?? null, ias: member.MBR_LAST_NAME ?? null },
    phone: { extracted: extractedFields.claimant?.phone_number ?? null, ias: member.MOBILE_NO ?? null },
    email: { extracted: extractedFields.claimant?.email_address ?? null, ias: member.EMAIL ?? null },
  };

  const checks = { hard, soft };

  if (hard.coverageActive === false) {
    const start = iasDateToYYYYMMDD(plan?.REINST_DATE) || iasDateToYYYYMMDD(plan?.EFF_DATE);
    const end = iasDateToYYYYMMDD(plan?.TERM_DATE) || iasDateToYYYYMMDD(plan?.EXP_DATE);
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'COVERAGE_NOT_ACTIVE',
      checks,
      reason: `Treatment date ${treatmentDate} falls outside the active coverage period (${start} to ${end}).`,
    };
  }
  if (hard.dobMatch === false) {
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'MEMBER_DETAILS_MISMATCH',
      checks,
      reason: `Claimant DOB "${extractedFields.claimant?.claimant_dob}" does not match IAS record DOB "${member.DOB}".`,
    };
  }
  if (hard.bankNameMatch === false || hard.bankAccountNameMatch === false || hard.bankAccountNumberMatch === false) {
    const mismatches = [];
    if (hard.bankNameMatch === false) {
      mismatches.push(`bank name ("${extractedFields.bank?.bank_name}" vs IAS "${member.BANK_NAME}")`);
    }
    if (hard.bankAccountNameMatch === false) {
      mismatches.push(`account name ("${extractedFields.bank?.bank_account_name}" vs IAS "${member.CL_PAY_ACCT_NAME}")`);
    }
    if (hard.bankAccountNumberMatch === false) {
      mismatches.push(`account number ("${extractedFields.bank?.bank_account_number}" vs IAS "${member.CL_PAY_ACCT_NO}")`);
    }
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'BANK_DETAILS_MISMATCH',
      checks,
      reason: `Bank details do not match IAS record: ${mismatches.join('; ')}.`,
    };
  }
  if (hard.policyNoMatch === false) {
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'MEMBER_DETAILS_MISMATCH',
      checks,
      reason: `Policy number "${extractedFields.policy?.policy_no}" does not match IAS record "${policy?.POCY_REF_NO}".`,
    };
  }

  return { outcome: 'MEMBER_VERIFIED', reasonCode: null, checks, reason: null };
}

module.exports = { evaluate };
