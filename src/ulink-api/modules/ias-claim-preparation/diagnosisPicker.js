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

// Below this, treat the pick as "didn't really find one" rather than forcing a guess into
// the claim payload — same reasoning as member-verification's null-means-can't-determine.
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * ICD-10 vector RAG (modules/icd10/lookup.js) supplies candidates; this adds the missing
 * "pick the single best one" step on top. `pick` is null (never a guess) if there's no free
 * text, no candidates, or the LLM's own confidence is too low — but `confidence` and
 * `candidates` are still returned in every case (empty/null where the LLM was never reached)
 * so the caller can persist *why* a pick did or didn't happen, not just the outcome. See
 * db/migrations/20260916100000-add-claim-prep-meta.js.
 */
async function pickDiagnosis(freeText) {
  if (!freeText || !freeText.trim()) return { pick: null, confidence: null, candidates: [] };

  const candidates = await findCandidates(freeText, { topK: 5 });
  if (candidates.length === 0) return { pick: null, confidence: null, candidates: [] };

  const userText = [
    `Clinical context:\n${freeText}`,
    '',
    'Candidates (nearest by vector similarity, not guaranteed correct):',
    ...candidates.map((c) => `- ${c.diagCode}: ${c.diagDesc} (similarity=${c.similarity.toFixed(3)})`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  const pick =
    result.diagCode && result.confidence >= CONFIDENCE_THRESHOLD
      ? { diagCode: result.diagCode, diagDesc: result.diagDesc }
      : null;

  return { pick, confidence: result.confidence, candidates };
}

module.exports = { pickDiagnosis };
