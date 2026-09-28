// Manual override: a reviewer lets a case past a check the AI flagged wrongly — the document check
// or the member check — with a reason, recorded against their login. Only the case status moves;
// every job after it runs exactly as it would have if the check had passed.
//
// Why only these: they are the checks that can stop a case where the AI may simply be wrong
// (a misread document, a name/number read differently from IAS). An API case with missing
// documents doesn't stop — it's already revised in IAS with a suspense — so it has no override.

// Where each overridable status goes: the status the check itself would have set on a pass.
const OVERRIDE_TARGETS = {
  INCOMPLETE: 'MEMBER_VERIFIED', // email: document check is the last check → straight to "checks passed"
  MEMBER_REVIEW_REQUIRED: 'READY_FOR_DOCUMENT_CHECKING', // email: member check → document check next
  API_MEMBER_REVIEW_REQUIRED: 'API_READY_FOR_DOCUMENT_CHECKING', // API: member check → document check next
};

// Which check an override of each status skips — matches the assessment summary's `area`, so the
// points that check raised count as dealt with afterwards.
const OVERRIDE_AREAS = {
  INCOMPLETE: 'documents',
  MEMBER_REVIEW_REQUIRED: 'member',
  API_MEMBER_REVIEW_REQUIRED: 'member',
};

// Why the reviewer thinks the check was wrong — one click, and the start of the AI accuracy data.
const OVERRIDE_FINDINGS = {
  AI_MISREAD: 'The AI misread the documents',
  CUSTOMER_CONFIRMED: "The customer's details were confirmed",
  IAS_OUTDATED: 'The IAS record is out of date',
  OTHER: 'Other (see reason)',
};

/**
 * Whether a case at this status, with these results, can be overridden.
 *   fields: the case fields (Case row / apiCaseView) — the member check result is read from them.
 * Returns { allowed: true, target } or { allowed: false, reason } (reason null = not an overridable status).
 */
function overrideCheck(status, fields = {}) {
  const target = OVERRIDE_TARGETS[status];
  if (!target) return { allowed: false, reason: null };
  // Claim preparation builds the IAS claim from the member's IAS record — with no member found
  // there is nothing to build it from, so letting it through would only fail later.
  if (fields.memberVerifyResult?.reasonCode === 'MEMBER_NOT_FOUND') {
    return { allowed: false, reason: 'The member was not found in IAS, so there is no IAS record to build the claim from. Fix it in IAS first; the member check then passes by itself.' };
  }
  return { allowed: true, target };
}

/**
 * The overrides recorded in a case's history (CaseEvent rows, reasonCode MANUAL_OVERRIDE) as the
 * assessment summary reads them: [{ area, at, note }]. note is the event's own text — "Overridden by
 * Ulink (ulink) — <why the check was wrong>: <reason>" — without the list of waived points.
 */
function overridesFromEvents(events = []) {
  return events
    .filter((e) => e.reasonCode === 'MANUAL_OVERRIDE' && OVERRIDE_AREAS[e.prevStatus])
    .map((e) => ({
      area: OVERRIDE_AREAS[e.prevStatus],
      at: e.createdAt,
      note: String(e.message || '').split(' (waived: ')[0],
    }));
}

module.exports = { OVERRIDE_TARGETS, OVERRIDE_AREAS, OVERRIDE_FINDINGS, overrideCheck, overridesFromEvents };
