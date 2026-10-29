const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');
const { findCandidates, findByCode } = require('../icd10/lookup');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'diagnosis-pick.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['diagCode', 'diagDesc', 'confidence', 'reason'],
  properties: {
    diagCode: { type: ['string', 'null'] },
    diagDesc: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    // Why this code (or none) — shown to reviewers in the assessment summary. Explanation only:
    // the pick never depends on it, and null is fine.
    reason: { type: ['string', 'null'] },
  },
};

// Below this, treat the pick as "didn't really find one" and fall back to
// DEFAULT_DIAGNOSIS instead — same reasoning as member-verification's
// null-means-can't-determine for the *confidence* judgment itself, but the resulting code
// still has to go somewhere: DiagnosisCode is a mandatory CL_CLAIM_API field for an STP
// submission (2026-09-16, at user's request — an STP case with a blank DiagnosisCode was
// failing at IAS submission, discovered later and less gracefully than catching it here).
const CONFIDENCE_THRESHOLD = 0.5;

// Real, standard ICD-10 catch-all — "Unknown and unspecified causes of morbidity" — used
// whenever there's no confident pick, so the payload always has a valid code instead of a
// blank mandatory field. `defaulted: true` on the result is the signal callers (see
// ias-claim-preparation/service.js's claimPrepMeta, console's ConfidenceSummary) use to
// show this was a fallback, not a real AI pick — never silently presented as confident.
const DEFAULT_DIAGNOSIS = { diagCode: 'R69', diagDesc: 'Unknown and unspecified causes of morbidity' };

/**
 * ICD-10 vector RAG (modules/icd10/lookup.js) supplies candidates; this adds the missing
 * "pick the single best one" step on top. `pick` falls back to DEFAULT_DIAGNOSIS (never a
 * fabricated *specific* code, just the standard "unspecified" one) if there's no free text,
 * no candidates, or the LLM's own confidence is too low — `defaulted: true` marks exactly
 * when that happened. `confidence` and `candidates` are still returned in every case
 * (empty/null where the LLM was never reached) so the caller can persist *why* a pick did or
 * didn't happen, not just the outcome. See db/migrations/20260916100000-add-claim-prep-meta.js.
 *
 * `searchText` (2026-10-01): what the ICD-10 search uses, when given — the illness text alone.
 * Drug names in the treatment text drowned the symptoms (case 42214c2a: "Coughing dizziness" +
 * "Im b12 Ampoxin Para…" found only diabetes / vitamin B12 codes, so it fell back to R69; the
 * illness text alone finds R42 Dizziness / R05 Cough). The pick itself still sees `freeText`,
 * treatment included, as context.
 */
async function pickDiagnosis(freeText, { searchText } = {}) {
  if (!freeText || !freeText.trim()) return { pick: DEFAULT_DIAGNOSIS, defaulted: true, confidence: null, reason: null, candidates: [] };

  const candidates = await findCandidates(searchText?.trim() || freeText, { topK: 5 });
  if (candidates.length === 0) return { pick: DEFAULT_DIAGNOSIS, defaulted: true, confidence: null, reason: null, candidates: [] };
  return askAi(freeText, candidates, ['Candidates (nearest by vector similarity, not guaranteed correct):']);
}

// The AI's pick among the candidates; heading: the lines before the list (what the list is).
async function askAi(freeText, candidates, heading) {
  const userText = [
    `Clinical context:\n${freeText || '(none)'}`,
    '',
    ...heading,
    ...candidates.map((c) => `- ${c.diagCode}: ${c.diagDesc}${c.similarity != null ? ` (similarity=${c.similarity.toFixed(3)})` : ''}`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  const confidentPick = result.diagCode && result.confidence >= CONFIDENCE_THRESHOLD;

  return {
    pick: confidentPick ? { diagCode: result.diagCode, diagDesc: result.diagDesc } : DEFAULT_DIAGNOSIS,
    defaulted: !confidentPick,
    confidence: result.confidence,
    reason: result.reason || null,
    candidates,
  };
}

/**
 * The diagnosis for a claim under a ULINK rule (diagnosisRules.js): its code from the IAS list, set without the AI
 * (rule.set: decided, no stop); with several codes, the AI picks only among them, given the rule's hint and the claim's
 * benefits. A code missing from the IAS list is left out; none left: null, and the caller picks as for any claim.
 * benefits: the claim's "TYPE/HEAD" per voucher (an operation room voucher is evidence of a caesarean).
 */
async function pickRuledDiagnosis(rule, freeText, { benefits = [] } = {}) {
  const candidates = (await Promise.all(rule.codes.map((code) => findByCode(code)))).filter(Boolean);
  if (candidates.length === 0) return null;
  const ruled = { label: rule.label, codes: rule.codes };
  if (rule.codes.length === 1) {
    const [{ diagCode, diagDesc }] = candidates;
    return { pick: { diagCode, diagDesc }, defaulted: false, confidence: null, reason: `Set from the benefit ${rule.label} (ULINK rule).`, candidates, rule: { ...ruled, set: true } };
  }
  const result = await askAi(freeText, candidates, [
    `Benefits on this claim: ${benefits.join(', ') || '(none)'}`,
    '',
    `ULINK rule for ${rule.label}: pick only one of these codes. ${rule.hint || ''}`.trim(),
  ]);
  return { ...result, rule: ruled };
}

module.exports = { pickDiagnosis, pickRuledDiagnosis, DEFAULT_DIAGNOSIS };
