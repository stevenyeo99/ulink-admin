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

// Reasons are read by people (case page, member-issue email): dates as YYYY-MM-DD on both sides, so a
// mismatch is visible at a glance. Anything that isn't a compact date is shown as it came.
function readableDate(yyyymmdd) {
  return /^\d{8}$/.test(yyyymmdd ?? '') ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : yyyymmdd;
}

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

// Account number length for each bank (owner, 2026-10-29, docs/imp/CR/SYSTEM_6/BANK_NO_CHECKING.md), on the bank name
// and number the AI read from the claim form — not IAS. A wrong number is a failed payment, so it holds the case for a
// person: Mark OK (the number is right) or correct it (checked again). Found by its short or full English name: "AYA",
// "AYA bank", "Ayeyarwady Bank". A
// bank not listed, no name, or a number that is not digits only (the document check's format check): not checked.
// Digits after spaces and dashes are removed; Burmese digits count. A new bank or length: one line.
const BANK_ACCOUNT_DIGITS = [
  { bank: 'AYA Bank', match: /\b(AYA|Ayeyarwadd?y)\b/i, digits: [11] },
  { bank: 'CB Bank', match: /\b(CB|Co-?operative)\b/i, digits: [16] },
  { bank: 'KBZ Bank', match: /\b(KBZ|Kanbawzar?)\b/i, digits: [17] },
  { bank: 'YOMA Bank', match: /\bYOMA\b/i, digits: [15] },
  { bank: 'UAB Bank', match: /\b(UAB|United Amara)\b/i, digits: [15, 16] },
];

// The number's length against its bank: { problem } (a finding's reason) when it does not fit, { unlisted } (a note, no
// stop: owner 2026-10-29) when the bank is not in ULINK's list, else null — no name, no number, or not digits only.
function bankNumberLength(bankName, accountNumber) {
  const digits = String(accountNumber ?? '').replace(/[\s-]+/g, '');
  if (!bankName || !/^[0-9\u1040-\u1049]+$/.test(digits)) return null;
  const rule = BANK_ACCOUNT_DIGITS.find((b) => b.match.test(bankName));
  if (!rule) return { unlisted: `Account number length not checked: "${bankName}" is not in ULINK's list of banks.` };
  if (rule.digits.includes(digits.length)) return null;
  return { problem: `Account number "${accountNumber}" has ${digits.length} digits, but ${rule.bank} account numbers have ${rule.digits.join(' or ')}.` };
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

// The member findings a person may mark OK one by one (not coverage — see evaluate).
// member:balance / member:exclusion (SYSTEM_5): the only action on them is this mark OK — the review page's "Bypass", with
// a reason. member:contract_exclusion (SYSTEM_5 contract exclusion): marked as not applying (wrongStep check) or let go on
// as an exception — the correction's wrongStep is kept on the accepted finding, for the STP rule.
const MEMBER_ITEM_LABELS = { 'member:dob': 'Member check: date of birth', 'member:bank': 'Member check: bank details', 'member:bank_number': 'Member check: bank account number', 'member:policy': 'Member check: policy number', 'member:balance': 'Member check: balance', 'member:exclusion': 'Member check: exclusion in IAS', 'member:contract_exclusion': 'Member check: policy contract exclusion' };
// Not member:bank: a bank difference is a warning that never holds the case (SYSTEM_5 bank check), so nothing to mark OK.
const ACCEPTABLE_MEMBER_ITEMS = new Set(Object.keys(MEMBER_ITEM_LABELS).filter((item) => item !== 'member:bank'));

// extraIssues: findings from outside this record's fields, listed after its own (member-verification/memberBalance.js's
// member:balance) — set aside by a person's mark OK the same way.
// off: the member checks a super admin switched off (AI checklist, SYSTEM_5 phase B) — their findings are dropped.
function evaluate(extractedFields, iasResponse, extraIssues = [], off = new Map()) {
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

  // Every failed check is reported (enhancement A2, 2026-09-29) — a reviewer or customer fixing only
  // the first problem would otherwise be flagged again for the next. Listed in priority order; the
  // first one is the case's reasonCode, which drives routing, dedupe and the email subject as before.
  const issues = [];
  if (hard.coverageActive === false) {
    const start = iasDateToYYYYMMDD(plan?.REINST_DATE) || iasDateToYYYYMMDD(plan?.EFF_DATE);
    const end = iasDateToYYYYMMDD(plan?.TERM_DATE) || iasDateToYYYYMMDD(plan?.EXP_DATE);
    issues.push({
      item: 'member:coverage',
      reasonCode: 'COVERAGE_NOT_ACTIVE',
      reason: `Treatment date ${readableDate(treatmentDate)} falls outside the active coverage period (${readableDate(start)} to ${readableDate(end)}).`,
    });
  }
  if (hard.dobMatch === false) {
    issues.push({
      item: 'member:dob',
      reasonCode: 'MEMBER_DETAILS_MISMATCH',
      reason: `Claimant DOB "${extractedFields.claimant?.claimant_dob}" does not match IAS record DOB "${readableDate(iasDateToYYYYMMDD(member.DOB)) ?? member.DOB}".`,
    });
  }
  let bankWarning = null;
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
    // A warning, not a finding (SYSTEM_5 bank check, owner 2026-10-27): the IAS claim pays to the IAS account
    // (payloadBuilder.js), so a difference does not change the payment — the case goes on and STP stays possible.
    if (!off.has('member:bank')) bankWarning = { code: 'member:bank', reason: `Bank details on the claim form differ from IAS: ${mismatches.join('; ')}. The IAS claim pays to the IAS account.` };
  }
  const bankNumber = bankNumberLength(extractedFields.bank?.bank_name, extractedFields.bank?.bank_account_number);
  if (bankNumber?.problem) issues.push({ item: 'member:bank_number', reasonCode: 'BANK_DETAILS_MISMATCH', reason: bankNumber.problem });
  // A bank ULINK gave no length for: shown on the case page as not checked, so it is never read as a pass.
  const bankNote = bankNumber?.unlisted && !off.has('member:bank_number') ? { code: 'member:bank_number', reason: bankNumber.unlisted } : null;
  if (hard.policyNoMatch === false) {
    issues.push({
      item: 'member:policy',
      reasonCode: 'MEMBER_DETAILS_MISMATCH',
      reason: `Policy number "${extractedFields.policy?.policy_no}" does not match IAS record "${policy?.POCY_REF_NO}".`,
    });
  }

  issues.push(...extraIssues);
  for (let i = issues.length - 1; i >= 0; i -= 1) if (off.has(issues[i].item)) issues.splice(i, 1);

  // Findings a person marked OK one by one (review page, a "member:…" verdict correction): set aside with who and why,
  // only while the finding is the one they saw (covers: its text, with both values) — a changed bank account or a new
  // IAS record is a new finding, held again. The case goes on once none is left. Coverage is never accepted this way (owner, 2026-10-19: paying outside the
  // policy period is a business decision — the whole-check override stays for that).
  const marked = new Map((extractedFields.corrections || [])
    .filter((c) => c.kind === 'verdict' && ACCEPTABLE_MEMBER_ITEMS.has(c.item) && c.corrected === true)
    .map((c) => [c.item, c]));
  // A finding with coverKeys (member:balance) is covered while each of its keys was in a bypass — all of them add up
  // (member check and claim preparation bypasses alike: each covers the vouchers a person decided on).
  const bypassedKeys = (item) => (extractedFields.corrections || [])
    .filter((c) => c.kind === 'verdict' && c.item === item && c.corrected === true).flatMap((c) => c.coverKeys || []);
  const isMarked = (issue) => marked.has(issue.item) && (issue.coverKeys
    ? issue.coverKeys.every((key) => bypassedKeys(issue.item).includes(key))
    : marked.get(issue.item).covers === issue.reason);
  const accepted = issues.filter(isMarked)
    .map((issue) => ({ ...issue, by: marked.get(issue.item).by ?? 'a person', acceptedReason: marked.get(issue.item).reason ?? '', wrongStep: marked.get(issue.item).wrongStep ?? null }));
  const open = issues.filter((issue) => !isMarked(issue));

  if (open.length > 0) {
    return {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: open[0].reasonCode,
      checks,
      reason: open.length === 1 ? open[0].reason : open.map((issue, i) => `${i + 1}. ${issue.reason}`).join(' '),
      issues: open,
      ...(accepted.length ? { accepted } : {}),
      ...(bankWarning ? { bankWarning } : {}),
      ...(bankNote ? { bankNote } : {}),
    };
  }

  return { outcome: 'MEMBER_VERIFIED', reasonCode: null, checks, reason: null, ...(accepted.length ? { accepted } : {}), ...(bankWarning ? { bankWarning } : {}), ...(bankNote ? { bankNote } : {}) };
}

module.exports = { evaluate, ACCEPTABLE_MEMBER_ITEMS, MEMBER_ITEM_LABELS };
