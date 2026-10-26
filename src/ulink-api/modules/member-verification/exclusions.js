// The member and policy exclusion events from IAS (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/MEMBER_EXCLUSION_PRD.md 4.2–4.3).
// Pure: takes the IAS answers as data (iasClient.js fetches them, exclusionJudge.js asks the AI). Owner rules, 2026-10-26:
// - both lists are read: memberEvents (level Member) and policyEvents (level Policy)
// - an event counts when it is dated on or before the treatment date, or has no date
// - an event with no description is listed, but cannot be judged

const { iasDateToIso: isoDate } = require('../shared/iasDates');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// An event date as YYYY-MM-DD: ISO with or without a time part, or IAS MMDDYYYY; null when unreadable.
const toIso = (d) => (typeof d !== 'string' ? null : ISO.test(d.slice(0, 10)) ? d.slice(0, 10) : isoDate(d));

// The request, from the member info answer: the policy and member numbers, each with its reference number as the
// fallback (Q7), and the policy start date. The endpoint needs the exact start of the period that covers the treatment,
// so the policy whose period holds the treatment date is used (else the first). Null when a value is missing.
// The policy period that holds the treatment date (YYYY-MM-DD), else the first — the period the balance and the
// exclusion requests are about.
function coveringPolicy(iasMemberInfoResponse, treatmentDate) {
  const policies = iasMemberInfoResponse?.payload?.policies || [];
  const covers = (p) => ISO.test(treatmentDate || '') && isoDate(p.EFF_DATE) && isoDate(p.EFF_DATE) <= treatmentDate
    && (!isoDate(p.EXP_DATE) || treatmentDate <= isoDate(p.EXP_DATE));
  return policies.find(covers) || policies[0];
}

function eventsRequest(iasMemberInfoResponse, treatmentDate = null) {
  const member = iasMemberInfoResponse?.payload?.member;
  const policy = coveringPolicy(iasMemberInfoResponse, treatmentDate);
  const policyEffDate = isoDate(policy?.EFF_DATE);
  const policyId = policy?.POCY_NO ? { policyNo: policy.POCY_NO } : policy?.POCY_REF_NO ? { policyRefNo: policy.POCY_REF_NO } : null;
  const memberId = member?.MBR_NO ? { memberNo: member.MBR_NO } : member?.MBR_REF_NO ? { memberRefNo: member.MBR_REF_NO } : null;
  return policyId && memberId && policyEffDate ? { ...policyId, ...memberId, policyEffDate } : null;
}

/**
 * Every event of both lists with its level, and whether it counts for this treatment date (YYYY-MM-DD).
 * [{ eventId, level: 'Member' | 'Policy', eventDate, description, counted, judgeable }]
 */
function readEvents(eventsResponse, treatmentDate) {
  const payload = eventsResponse?.payload || {};
  const levelled = [
    ...(payload.memberEvents || []).map((e) => ({ ...e, level: 'Member' })),
    ...(payload.policyEvents || []).map((e) => ({ ...e, level: 'Policy' })),
  ];
  return levelled.map((e, i) => {
    const description = typeof e.eventDescription === 'string' && e.eventDescription.trim() ? e.eventDescription.trim() : null;
    // A date that is not YYYY-MM-DD on either side, or no treatment date: the event counts (a person decides rather
    // than skip one).
    const eventDate = toIso(e.eventDate);
    const comparable = Boolean(eventDate) && ISO.test(treatmentDate || '');
    const counted = !comparable || eventDate <= treatmentDate;
    // key: level + id — IDs are unique only within their own list (spec); an event with no id gets its place instead.
    const id = e.eventId == null || e.eventId === '' ? `#${i + 1}` : String(e.eventId);
    return { key: `${e.level}:${id}`, eventId: id, level: e.level, eventDate: eventDate ?? e.eventDate ?? null, description, counted, judgeable: counted && Boolean(description) };
  });
}

// What the claim is for — the fields read from its documents — which the AI compares with each event's meaning (4.4).
// No dates: the AI does no date reasoning on the free text (owner, 2026-10-26); a person checks a date written in an
// event. medical: the diagnosis and treatment text, translated when Burmese (memberBalance does it once).
function claimFacts(extractedFields, medical) {
  return {
    diagnosis: medical?.diagnosis ?? extractedFields?.medical?.detail_of_illness_injury ?? null,
    treatment: medical?.treatment ?? extractedFields?.medical?.full_description_of_treatment ?? null,
    vouchers: (extractedFields?.invoices?.items || []).map((item, i) => ({ voucher: i + 1, type: item.voucher_type ?? null, amount: item.subtotal ?? null })),
    treatmentOutsideMyanmar: extractedFields?.claim?.treatment_outside_myanmar ?? null,
  };
}

module.exports = { isoDate, coveringPolicy, eventsRequest, readEvents, claimFacts };
