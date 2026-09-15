const config = require('../../config');

const CHAT_ENDPOINT = '/v1/chat/completions';

function buildImageDataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function postChatCompletion(body) {
  if (!config.llm.baseUrl) {
    throw new Error('LLM_URL is required for claim-recognition');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  let response;
  try {
    response = await fetch(new URL(CHAT_ENDPOINT, config.llm.baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${config.llm.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LLM request failed (${response.status} ${response.statusText}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

/**
 * Vision pass — transcribes ONE page image per call, always. Batching multiple images
 * into one request was verified to risk multi-minute hangs even at otherwise-safe image
 * sizes (Day-1 testing against the real sample documents).
 *
 * reasoning_effort is hardcoded to 'low' here, not read from config — this is literal
 * OCR (Tier 1: read what's on the page), never genuine judgment, so it has no principled
 * use for reasoning at all. Previously read config.llm.reasoningEffort (a single value
 * shared with every other LLM call in the system, including genuine judgment calls) —
 * confirmed via real LM Studio response logs (2026-09-14) that setting that shared value
 * to anything but 'low' lets the model spend its entire max_tokens budget on
 * reasoning_content before writing any actual transcription, producing `content: ""`
 * ("LLM returned an empty page transcription") on harder pages — the reasoning pass is
 * unbounded on hard vision content (e.g. handwriting) and doesn't reliably leave room for
 * the answer itself. Hardcoding this call specifically to 'low' keeps OCR from inheriting
 * a higher reasoning setting tuned for a genuine judgment call elsewhere.
 */
async function transcribePage({ imageBuffer, instruction }) {
  if (imageBuffer.length > config.llm.maxRequestBytes) {
    throw new Error(`Page image exceeds LLM_MAX_REQUEST_BYTES (${imageBuffer.length} bytes)`);
  }

  const data = await postChatCompletion({
    model: config.llm.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: buildImageDataUrl(imageBuffer) } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: config.claimRecognition.maxTokensPerPage,
    reasoning_effort: 'low',
  });

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM returned an empty page transcription');
  }
  return content.trim();
}

/**
 * Text-only synthesis pass — merges page transcriptions into a fixed JSON shape. No images
 * here, so it's fast and considerably more reliable at strict JSON than the vision pass.
 * Caller is responsible for validating the result against its own JSON Schema (ajv) — this
 * only guarantees "valid JSON", not "matches our schema".
 *
 * `reasoningEffort` defaults to config.llm.reasoningEffort (the shared setting, unchanged
 * for every existing caller — modules/policy-exclusion/judge.js,
 * modules/ias-claim-preparation's diagnosisPicker/benefitPicker) but claim-recognition's
 * own callers (decideRoute/extractFields — see service.js) pass 'low' explicitly: neither
 * is a genuine judgment call (Task 3/identity_consistency was removed), so there's no
 * principled reason for them to spend budget on reasoning, same logic as transcribePage
 * above. Judgment-type callers keep using the shared config value for now — that's a
 * separate tuning decision, not addressed by this claim-recognition-scoped change.
 */
async function synthesizeJson({ systemPrompt, userText, jsonSchema, reasoningEffort = config.llm.reasoningEffort }) {
  const data = await postChatCompletion({
    model: config.llm.assistantModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    temperature: 0,
    reasoning_effort: reasoningEffort,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'claim_recognition_result', schema: jsonSchema, strict: true },
    },
  });

  return extractJson(data?.choices?.[0]?.message?.content);
}

// --- JSON repair parsing --------------------------------------------------
// Local models are less consistent than hosted APIs about returning strictly valid JSON
// even when a schema is requested (code fences, trailing commas are the common cases).

function stripCodeFences(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractFirstBalancedJson(text) {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return text;

  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

function extractJson(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM response content is empty');
  }

  const normalized = extractFirstBalancedJson(stripCodeFences(content));
  const attempts = [normalized, removeTrailingCommas(normalized)];

  let lastError;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to parse LLM JSON response');
}

module.exports = { transcribePage, synthesizeJson };
