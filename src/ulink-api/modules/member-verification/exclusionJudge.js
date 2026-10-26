const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');

// The AI judges the member and policy exclusion events by meaning against the claim (SYSTEM_5,
// docs/imp/CR/SYSTEM_5/PRD/MEMBER_EXCLUSION_PRD.md 4.4). One call per case for all the events that count. The prompt
// (prompts/exclusion-events.md) carries the three kinds of rule IAS staff type (IAS samples, 4.8).

const PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'exclusion-events.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['results'],
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['eventId', 'applies', 'confidence', 'reason'],
        additionalProperties: false,
        properties: {
          eventId: { type: 'string' },
          applies: { type: 'boolean' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/**
 * facts: exclusions.js claimFacts(). events: exclusions.js readEvents(); only the judgeable ones are sent. threshold: the
 * AI confidence threshold (System settings): at or below it an answer is unsure (Q5).
 *
 * Returns every event, the judged ones with { applies, confidence, reason, unsure, match }: match is true for a likely
 * match or an unsure answer — the case stops for a person (4.5). An event the AI did not answer counts as unsure.
 */
async function judgeExclusionEvents(facts, events, threshold) {
  // A counted event with no description cannot be read: unsure, so a person reads it in IAS (never skipped).
  const unreadable = (e) => ({ ...e, applies: null, confidence: null, reason: 'IAS gives no description: a person reads the event in IAS.', unsure: true, match: true });
  const judgeable = events.filter((e) => e.judgeable);
  if (!judgeable.length) return events.map((e) => (e.counted && !e.description ? unreadable(e) : e));
  // id: level + event id — event ids are unique only within their own list (spec).
  const userText = JSON.stringify({
    claim: facts,
    events: judgeable.map((e) => ({ id: e.key, level: e.level, description: e.description })),
  }, null, 2);
  const result = await synthesizeJson({ systemPrompt: PROMPT, userText, jsonSchema: SCHEMA, label: 'exclusion-events' });
  const answers = new Map((result?.results || []).map((r) => [String(r.eventId), r]));
  return events.map((e) => {
    if (e.counted && !e.description) return unreadable(e);
    if (!e.judgeable) return e;
    // The AI may echo the bare IAS id: use it only when no other judged event shares it.
    const a = answers.get(e.key) ?? (judgeable.filter((x) => x.eventId === e.eventId).length === 1 ? answers.get(e.eventId) : undefined);
    const confidence = typeof a?.confidence === 'number' && a.confidence >= 0 && a.confidence <= 1 ? a.confidence : null;
    const unsure = confidence == null || confidence <= threshold;
    return {
      ...e, applies: confidence == null ? null : a.applies === true, confidence,
      reason: a?.reason ?? 'The AI gave no answer for this event.', unsure, match: unsure || a.applies === true,
    };
  });
}

module.exports = { judgeExclusionEvents, PROMPT };
