const { findCandidates } = require('../policy-exclusion/lookup');
const { judgeExclusion } = require('../policy-exclusion/judge');
const { findOverrides } = require('../policy-exclusion/overrideLookup');

/**
 * Composes the policy-exclusion RAG-judge check into the flags array attached to
 * member-verification's result (see checks.js's evaluate()) — this never changes
 * outcome/reasonCode, per SOP §6.3/§14: JD1 flags a possible exclusion for JD2 to review,
 * it never rejects on this.
 *
 * Policyholder overrides (modules/policy-exclusion/overrideLookup.js) are only looked up
 * once a base clause is actually flagged, attached as context on that same flag — not
 * surfaced unconditionally on every case. Several override rows apply broadly ("Both
 * individual and group policies"), so querying them independent of an actual flag would
 * put the same generic note on every single case regardless of relevance; JD2 already has
 * the full override sheet as reference, this only needs to point them at it when there's
 * something to weigh it against.
 */
async function checkExclusions(extractedFields, routeKey) {
  const diagnosisText = extractedFields.medical?.detail_of_illness_injury;
  const treatmentText = extractedFields.medical?.full_description_of_treatment;
  if (!routeKey || (!diagnosisText && !treatmentText)) return [];

  const queryText = [diagnosisText, treatmentText].filter(Boolean).join(' — ');
  const candidates = await findCandidates(queryText, routeKey);
  const judgment = await judgeExclusion({ diagnosisText, treatmentText, candidates });
  if (!judgment) return [];

  const overrides = await findOverrides(extractedFields.policy?.company_name, routeKey);

  return [
    {
      code: 'POSSIBLE_EXCLUSION',
      clauseRef: judgment.clauseRef,
      severity: judgment.severity,
      confidence: judgment.confidence,
      policyHolderOverrides: overrides.map((o) => ({ coverageArea: o.coverageArea, note: o.note })),
    },
  ];
}

module.exports = { checkExclusions };
