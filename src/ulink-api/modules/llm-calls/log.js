const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../../utils/logger');

// The AI call log (SYSTEM_4 E4-26): one ulink_llm_calls row per call to the AI, written by the AI client
// (claim-recognition/llmClient.js) — the one place every call passes through, so none is missed.

// Which case and job a call is for. Each job sets it once where it starts on a case (api-pipeline/runApiJob.js and
// the email jobs that call the AI); the AI client reads it, so the code calling the AI doesn't pass it along.
const context = new AsyncLocalStorage();
const forCase = (caseId, job, fn) => context.run({ caseId, job }, fn);

// Prompt name and version from the prompt text itself: every prompt is a modules/*/prompts/*.md file, sent as written.
// Version = the start of the text's SHA-256, so an edited prompt is a new version with nothing to remember.
const fingerprint = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
const MODULES_DIR = path.join(__dirname, '..');
const PROMPTS = new Map();
for (const moduleName of fs.readdirSync(MODULES_DIR)) {
  const dir = path.join(MODULES_DIR, moduleName, 'prompts');
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    PROMPTS.set(fingerprint(text), path.basename(file, '.md'));
  }
}
function promptOf(text) {
  if (text == null) return { promptName: null, promptVersion: null };
  const version = fingerprint(text);
  return { promptName: PROMPTS.get(version) ?? 'unknown', promptVersion: version };
}

// The answer's own confidence, when it is a JSON object with one.
function confidenceOf(output) {
  try {
    const value = JSON.parse(output)?.confidence;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Records one call. Never throws and never delays the claim: a failed write only goes to the server log.
 *   call: { callType, prompt (the prompt text), model, status, durationMs, usage, estimatedTokens, output, error }
 */
function recordCall({ callType, prompt, model = null, status, durationMs = null, usage = null, estimatedTokens = null, output = null, error = null }) {
  const { caseId = null, job = null } = context.getStore() || {};
  const row = {
    caseId,
    job,
    callType,
    ...promptOf(prompt),
    model,
    status,
    durationMs,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    estimatedTokens,
    output,
    confidence: output == null ? null : confidenceOf(output),
    error,
  };
  // Required here, not at the top: the AI client is loaded by code (and tests) without a database.
  return Promise.resolve()
    .then(() => require('../../db/models').LlmCall.create(row))
    .catch((e) => logger.warn('AI call log write failed', { error: e.message, job, promptName: row.promptName }));
}

// The prompts on this server now: [{ promptName, promptVersion }] — so a prompt with no calls yet still shows.
const currentPrompts = () => [...PROMPTS].map(([promptVersion, promptName]) => ({ promptName, promptVersion }));

module.exports = { forCase, recordCall, promptOf, currentPrompts };
