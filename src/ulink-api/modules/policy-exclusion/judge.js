const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'exclusion-judge.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['excluded', 'clauseRef', 'severity', 'confidence'],
  properties: {
    excluded: { type: 'boolean' },
    clauseRef: { type: ['string', 'null'] },
    severity: { type: ['string', 'null'], enum: ['exclude', 'cap', null] },
    confidence: { type: 'number' },
  },
};

// Below this, treat the judgment as "didn't really find a match" — same reasoning as
// ias-claim-preparation's pickers (benefitPicker.js/diagnosisPicker.js) and
// member-verification's null-means-can't-determine. This flag reaches a human (JD2) either
// way, per SOP §6.3/§14 — never a rejection — so a low-confidence non-match is the safe
// default, not a forced guess.
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Judges whether a claim's diagnosis/treatment falls under any of the given candidate
 * exclusion clauses (from lookup.js's findCandidates). Returns null (never a guess) if
 * there's no free text, no candidates, or confidence is too low.
 */
async function judgeExclusion({ diagnosisText, treatmentText, candidates }) {
  if (!diagnosisText && !treatmentText) return null;
  if (!candidates || candidates.length === 0) return null;

  const userText = [
    `Diagnosis/illness description: ${diagnosisText || '(none)'}`,
    `Treatment description: ${treatmentText || '(none)'}`,
    '',
    'Candidate exclusion clauses (nearest by vector similarity, not guaranteed to apply):',
    ...candidates.map((c) => `- ${c.clauseRef}: ${c.clauseText}`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  if (!result.excluded || !result.clauseRef || result.confidence < CONFIDENCE_THRESHOLD) return null;

  return { clauseRef: result.clauseRef, severity: result.severity, confidence: result.confidence };
}

module.exports = { judgeExclusion };
