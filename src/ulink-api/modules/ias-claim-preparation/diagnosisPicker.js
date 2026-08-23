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
 * "pick the single best one" step on top. Returns null (never a guess) if there's no free
 * text, no candidates, or the LLM's own confidence is too low.
 */
async function pickDiagnosis(freeText) {
  if (!freeText || !freeText.trim()) return null;

  const candidates = await findCandidates(freeText, { topK: 5 });
  if (candidates.length === 0) return null;

  const userText = [
    `Diagnosis/illness description: ${freeText}`,
    '',
    'Candidates (nearest by vector similarity, not guaranteed correct):',
    ...candidates.map((c) => `- ${c.diagCode}: ${c.diagDesc} (similarity=${c.similarity.toFixed(3)})`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  if (!result.diagCode || result.confidence < CONFIDENCE_THRESHOLD) return null;

  return { diagCode: result.diagCode, diagDesc: result.diagDesc };
}

module.exports = { pickDiagnosis };
