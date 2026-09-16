const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');
const { findCandidates } = require('../icd10/lookup');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'diagnosis-pick.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['diagCode', 'diagDesc', 'confidence'],
  properties: {
    diagCode: { type: ['string', 'null'] },
    diagDesc: { type: ['string', 'null'] },
    confidence: { type: 'number' },
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
 */
async function pickDiagnosis(freeText) {
  if (!freeText || !freeText.trim()) return { pick: DEFAULT_DIAGNOSIS, defaulted: true, confidence: null, candidates: [] };

  const candidates = await findCandidates(freeText, { topK: 5 });
  if (candidates.length === 0) return { pick: DEFAULT_DIAGNOSIS, defaulted: true, confidence: null, candidates: [] };

  const userText = [
    `Clinical context:\n${freeText}`,
    '',
    'Candidates (nearest by vector similarity, not guaranteed correct):',
    ...candidates.map((c) => `- ${c.diagCode}: ${c.diagDesc} (similarity=${c.similarity.toFixed(3)})`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  const confidentPick = result.diagCode && result.confidence >= CONFIDENCE_THRESHOLD;

  return {
    pick: confidentPick ? { diagCode: result.diagCode, diagDesc: result.diagDesc } : DEFAULT_DIAGNOSIS,
    defaulted: !confidentPick,
    confidence: result.confidence,
    candidates,
  };
}

module.exports = { pickDiagnosis, DEFAULT_DIAGNOSIS };
