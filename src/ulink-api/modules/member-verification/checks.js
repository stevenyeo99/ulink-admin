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
    // Known limitation, accepted as-is per the settled Hard-tier design: this is a plain
    // normalized string compare, unlike JD1's identity_consistency (LLM-judged
    // specifically to handle Burmese-vs-Latin-script/transliteration name variants — see
    // checklist.js/synthesize.md). A person whose name is legitimately the same but
    // written in a different script/spelling than IAS's own record will false-positive
    // here as a mismatch. Accepted for now since a real mismatch (a genuinely different
    // payee, e.g. the jd2 delegation-letter case) is the far more likely real-world
    // trigger; revisit if false positives show up in practice.
    bankAccountNameMatch: compare(extractedFields.bank?.bank_account_name, member.CL_PAY_ACCT_NAME),
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
