const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');

const ENTITY_MATCH_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'entity-match.md'), 'utf8');
const MEANING_MATCH_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'meaning-match.md'), 'utf8');

// Shared by both judges below — same output shape (a boolean judgment + confidence +
// reason) whether the question is "same entity?" or "does B support A?", so one schema
// and one confidence-gating rule covers both; no reason to duplicate either.
const SCHEMA = {
  type: 'object',
  required: ['consistent', 'confidence', 'reason'],
  properties: {
    consistent: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
};

// Below this, treat the judgment as "can't tell" rather than a confident answer either way
// — same reasoning as every other confidence-gated judge in this codebase
// (policy-exclusion/judge.js, ias-claim-preparation's pickers).
const CONFIDENCE_THRESHOLD = 0.5;

async function judge(systemPrompt, userText) {
  const result = await synthesizeJson({ systemPrompt, userText, jsonSchema: SCHEMA });
  if (result.confidence < CONFIDENCE_THRESHOLD) return null;
  return { consistent: result.consistent, confidence: result.confidence, reason: result.reason };
}

/**
 * The one reusable "same person/place?" judge — replaces Task 3's bundled
 * identity_consistency judgments (removed from claim-recognition's extraction call), now
 * isolated so a bad case in one comparison can't affect any other. Called once per
 * comparison (bank-account-holder, delegation-payee, patient name, provider name, hospital
 * name) — see document-checking/service.js for the call sites, run in parallel via
 * Promise.all since they're independent of each other.
 *
 * Returns null (never a guess) when either input is null (nothing to compare — same
 * null-means-can't-determine convention as everywhere else) or confidence is too low.
 */
async function entityMatch(a, b) {
  if (a == null || b == null) return null;
  return judge(ENTITY_MATCH_PROMPT, [`Value A: ${a}`, `Value B: ${b}`].join('\n'));
}

/**
 * Item 18 (SOP §8, "Medical Record must support claim") — a genuinely different question
 * from entityMatch: not "do these name the same thing", but "does the medical record's
 * stated diagnosis/treatment reasonably support the claim form's". Deliberately its own
 * prompt (meaning-match.md), not entity-match.md reused with different wording — same
 * "narrow, single-purpose call" principle as everything else built this session. Shares
 * this module's schema/confidence-gating since the output shape is identical.
 */
async function meaningMatch(claimText, recordText) {
  if (claimText == null || recordText == null) return null;
  return judge(MEANING_MATCH_PROMPT, [`Claim form states: ${claimText}`, `Medical record states: ${recordText}`].join('\n'));
}

module.exports = { entityMatch, meaningMatch };
