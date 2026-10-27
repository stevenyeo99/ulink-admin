const crypto = require('crypto');
const { findCandidates } = require('../policy-exclusion/lookup');
const { judgeExclusion } = require('../policy-exclusion/judge');
const { findOverrides } = require('../policy-exclusion/overrideLookup');

/**
 * The policy contract exclusion check (SOP §6.3; SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/CONTRACT_EXCLUSION_PRD.md): the
 * contract clauses nearest the diagnosis / treatment text, judged by the AI. A match is a member finding
 * (member:contract_exclusion) that holds the case for a person (owner, 2026-10-27) — never a rejection: the person marks
 * it as not applying, or lets it go on (then no STP).
 *
 * Policyholder overrides (modules/policy-exclusion/overrideLookup.js) are only looked up
 * once a base clause is actually flagged, attached as context on that same flag — not
 * surfaced unconditionally on every case. Several override rows apply broadly ("Both
 * individual and group policies"), so querying them independent of an actual flag would
 * put the same generic note on every single case regardless of relevance; JD3 already has
 * the full override sheet as reference, this only needs to point them at it when there's
 * something to weigh it against.
 */

// What the AI judged: the text, the product and the policyholder — the same fingerprint reuses the last answer, so a case
// re-checked every run at member review costs no new AI call, and the finding a person saw stays the same (PRD 4.4).
const fingerprintOf = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

// The member finding for a flag. coverKeys: the clause and the text it was judged on, so a person's answer covers
// exactly that match — a new clause, or a corrected text that matches again, is a new decision (PRD 4.3).
function contractIssue(flag, fingerprint) {
  const clause = `clause ${flag.clauseRef}${flag.clauseText ? ` "${flag.clauseText.replace(/\.$/, '')}"` : ''}`;
  const cap = flag.severity === 'cap' ? ' The clause limits the amount.' : '';
  return {
    item: 'member:contract_exclusion',
    reasonCode: 'POSSIBLE_EXCLUSION',
    reason: `Possible policy contract exclusion: ${clause} (confidence ${flag.confidence}).${cap}${flag.reason ? ` AI: ${flag.reason}` : ''}`,
    coverKeys: [`${flag.clauseRef}@${fingerprint}`],
  };
}

/**
 * Returns { fingerprint, flag, issue } — flag null when no clause applies — or null when there is nothing to judge.
 * previous: the last check's { fingerprint, flag } (memberVerifyResult.contractExclusion), reused while unchanged.
 */
async function checkExclusions(extractedFields, routeKey, previous = null) {
  const diagnosisText = extractedFields.medical?.detail_of_illness_injury;
  const treatmentText = extractedFields.medical?.full_description_of_treatment;
  if (!routeKey || (!diagnosisText && !treatmentText)) return null;

  const companyName = extractedFields.policy?.company_name;
  const fingerprint = fingerprintOf(diagnosisText ?? null, treatmentText ?? null, routeKey, companyName ?? null);
  const flag = previous?.fingerprint === fingerprint ? previous.flag : await judge(diagnosisText, treatmentText, routeKey, companyName);
  return { fingerprint, flag, issue: flag ? contractIssue(flag, fingerprint) : null };
}

async function judge(diagnosisText, treatmentText, routeKey, companyName) {
  const queryText = [diagnosisText, treatmentText].filter(Boolean).join(' — ');
  const candidates = await findCandidates(queryText, routeKey);
  const judgment = await judgeExclusion({ diagnosisText, treatmentText, candidates });
  if (!judgment) return null;

  const overrides = await findOverrides(companyName, routeKey);

  return {
    code: 'POSSIBLE_EXCLUSION',
    clauseRef: judgment.clauseRef,
    clauseText: judgment.clauseText,
    reason: judgment.reason,
    severity: judgment.severity,
    confidence: judgment.confidence,
    policyHolderOverrides: overrides.map((o) => ({ coverageArea: o.coverageArea, note: o.note })),
  };
}

module.exports = { checkExclusions, contractIssue };
