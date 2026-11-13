const { getMemberClaimHistory } = require('./iasClient');

// Another claim in IAS with the same incurred date (owner 2026-11-12, docs/imp/UAT/IAS_MEMBER_CLAIM_HISTORY_API_SPECS.md):
// this claim's visit date and every voucher date, against every claim IAS holds for the member in the coverage period,
// whatever its status. The claim being checked is left out by its claim number: an API case's claim already exists in
// IAS. An email case also matches an IAS claim with its own TPA case number, whatever the date: the same claim sent twice
// (owner 2026-11-12). A match is one more member finding (member:same_date_claim) that holds the case for a person.
// One IAS call, no AI call.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// The visit date (an accident claim's accident date, else the appointment date, as the member check uses: it picks the
// IAS coverage period), and the dates compared: the accident date, the appointment date and every voucher date, without
// repeats (owner 2026-11-12: an accident on 1 June with a visit on 3 June compares both days).
function claimDates(extractedFields) {
  const visit = extractedFields.claim?.accident_date || extractedFields.claim?.appointment_date || null;
  const dates = [extractedFields.claim?.accident_date, extractedFields.claim?.appointment_date, ...(extractedFields.invoices?.items || []).map((item) => item?.date)]
    .filter((date) => ISO.test(date || ''));
  return { visit: ISO.test(visit || '') ? visit : null, dates: [...new Set(dates)] };
}

const isThisClaim = (claim, own) => Boolean(own.claimNo && claim.claimNo === own.claimNo);

const claimName = (m) => m.claimNo || m.tpaCaseNumber || '(no claim number)';

// The member:same_date_claim finding, or null. coverKeys: each matching claim and date, so a new claim or a new date is
// a new decision for a person.
function sameDateIssue(matches) {
  if (!matches.length) return null;
  const what = (m) => [m.dates.length && `on ${m.dates.join(', ')}`, m.sameCaseNumber && `for the same TPA case number ${m.tpaCaseNumber}`].filter(Boolean).join(' and ');
  const text = matches.map((m) => `claim ${claimName(m)}${m.tpaCaseNumber && m.claimNo && !m.sameCaseNumber ? ` (${m.tpaCaseNumber})` : ''} ${what(m)}${m.status ? `, status ${m.status}` : ''}`);
  return {
    item: 'member:same_date_claim',
    reasonCode: 'SAME_DATE_CLAIM',
    reason: `IAS already has a claim with the same incurred date or case number: ${text.join('; ')}.`,
    coverKeys: matches.flatMap((m) => [...m.dates.map((date) => `${claimName(m)}|${date}`), ...(m.sameCaseNumber ? [`${claimName(m)}|case`] : [])]),
  };
}

/**
 * Returns { checked, note, matches, issue }. own: { claimNo } of the claim being checked, left out, and caseNumber: an
 * email case's own TPA case number (claim form), matched whatever the date; null for an API case.
 * checked false (with a note) when IAS has no member number, the claim has no visit date, or IAS answered success: false
 * — the case is not stopped for it. An IAS network error or non-2xx answer throws: the member check runs again next time.
 */
async function checkSameDateClaims(extractedFields, iasMemberInfoResponse, own = {}) {
  const notChecked = (note) => ({ checked: false, note, matches: [], issue: null });
  const memberRefNo = iasMemberInfoResponse?.payload?.member?.MBR_REF_NO;
  const { visit, dates } = claimDates(extractedFields);
  if (!memberRefNo) return notChecked('The IAS member record has no member reference number.');
  if (!visit) return notChecked('The claim has no visit date.');
  const response = await getMemberClaimHistory({ memberRefNo, meplEffDate: visit });
  if (response?.success !== true) return notChecked(`IAS did not return the member's claims${response?.error ? ` (${response.error})` : ''}.`);

  const matches = (response.payload?.claims || [])
    .filter((claim) => !isThisClaim(claim, own))
    .map((claim) => ({
      claimNo: claim.claimNo ?? null,
      tpaCaseNumber: claim.tpaCaseNumber ?? null,
      status: claim.status ?? null,
      dates: (Array.isArray(claim.incurredDates) ? claim.incurredDates : [claim.incurredDate]).filter((date) => dates.includes(date)),
      sameCaseNumber: Boolean(own.caseNumber && claim.tpaCaseNumber === own.caseNumber),
    }))
    .filter((m) => m.dates.length || m.sameCaseNumber);
  return { checked: true, note: null, matches, issue: sameDateIssue(matches) };
}

module.exports = { checkSameDateClaims, claimDates };
