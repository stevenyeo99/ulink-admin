const crypto = require('crypto');
const { getMemberPolicyEvents } = require('./iasClient');
const { eventsRequest, readEvents, claimFacts } = require('./exclusions');
const { judgeExclusionEvents } = require('./exclusionJudge');
const { toEnglishMedicalText } = require('../ias-claim-preparation/medicalTranslation');
const { lastReadSettings } = require('../settings/settings');

// The member and policy exclusion step of the member check (SYSTEM_5 member exclusion phase B,
// docs/imp/CR/SYSTEM_5/PRD/MEMBER_EXCLUSION_PRD.md 4.1–4.6): IAS's exclusion events, judged by meaning against what the
// claim is for. Not pure: one IAS call, and one AI call when something counts and changed.

// What a person sees per matching event, with its level (4.5).
const lineText = (e) => `${e.level} exclusion${e.eventDate ? ` (${e.eventDate})` : ''}: "${e.description ?? '(no description)'}" — ${e.unsure && e.applies !== true ? 'not sure: ' : ''}${e.reason}${e.confidence != null ? ` (${e.confidence})` : ''}`;

// The member:exclusion finding from the judged events, or null when none matches. coverKeys: the events a bypass
// covers (level + id), so a new matching event is a new decision (4.6).
function exclusionIssue(events) {
  const matches = events.filter((e) => e.match);
  return matches.length
    ? { item: 'member:exclusion', reasonCode: 'POSSIBLE_MEMBER_EXCLUSION', reason: `Possible exclusion in IAS: ${matches.map(lineText).join('; ')}.`, coverKeys: matches.map((e) => e.key) }
    : null;
}

// What the AI judged: the counted events' text and the claim facts — the same fingerprint reuses the last answer, so a
// case re-checked every run at member review costs no new AI call (5.3).
const fingerprintOf = (events, facts, threshold) => crypto.createHash('sha256')
  .update(JSON.stringify({ events: events.map((e) => [e.key, e.description, e.counted]), facts, threshold })).digest('hex').slice(0, 16);

/**
 * Returns { checked, note, fingerprint, events, issue }. checked false (with a note) when the events could not be read:
 * the IAS record lacks a policy, member or start date, or IAS answered success: false — the case is not stopped for it.
 * An IAS network error or non-2xx answer throws: the member check fails and runs again next time.
 */
async function checkMemberExclusions(extractedFields, iasMemberInfoResponse, previous = null) {
  const notChecked = (note) => ({ checked: false, note, fingerprint: null, events: [], issue: null });
  const treatmentDate = extractedFields.claim?.accident_date || extractedFields.claim?.appointment_date || null;
  const request = eventsRequest(iasMemberInfoResponse, treatmentDate);
  if (!request) return notChecked('The IAS member record has no policy number, member number or policy start date.');
  const response = await getMemberPolicyEvents(request);
  if (response?.success !== true) return notChecked(`IAS did not return the exclusion events${response?.error ? ` (${response.error})` : ''}.`);

  const events = readEvents(response, treatmentDate);
  const facts = claimFacts(extractedFields, null);
  const threshold = lastReadSettings().aiConfidenceThreshold;
  const fingerprint = fingerprintOf(events, facts, threshold);
  const judged = previous?.checked && previous.fingerprint === fingerprint
    ? previous.events
    : await judgeExclusionEvents(await translated(extractedFields, facts, events), events, threshold);
  return { checked: true, note: null, fingerprint, events: judged, issue: exclusionIssue(judged) };
}

// The claim facts with the diagnosis and treatment in English, when there is an event to judge (Burmese text is translated).
async function translated(extractedFields, facts, events) {
  if (!events.some((e) => e.judgeable)) return facts;
  const medical = await toEnglishMedicalText({ diagnosis: facts.diagnosis, treatment: facts.treatment });
  return claimFacts(extractedFields, medical);
}

module.exports = { checkMemberExclusions, exclusionIssue };
