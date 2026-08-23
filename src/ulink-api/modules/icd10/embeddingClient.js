const config = require('../../config');

const EMBEDDINGS_ENDPOINT = '/v1/embeddings';

// Nomic Embed Text v1.5's documented task-prefix convention — corpus text indexed with
// "search_document:", lookup text embedded with "search_query:" at query time. This isn't
// cosmetic: using the wrong prefix (or none) measurably hurts retrieval quality for this
// model family, since it was trained to condition on these prefixes.
const TASK_PREFIX = {
  DOCUMENT: 'search_document: ',
  QUERY: 'search_query: ',
};

/**
 * Returns a single embedding vector (number[]) for `text`. Same timeout/error-handling
 * shape as modules/claim-recognition/llmClient.js's postChatCompletion — an external call
 * must not be able to hang the caller (ingestion script, lookup module).
 */
async function embed(text, { taskPrefix } = {}) {
  if (!config.embedding.baseUrl) {
    throw new Error('EMBEDDING_URL (or LLM_URL) is required for modules/icd10');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.embedding.timeoutMs);

  let response;
  try {
    response = await fetch(new URL(EMBEDDINGS_ENDPOINT, config.embedding.baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.embedding.model, input: `${taskPrefix || ''}${text}` }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Embedding request timed out after ${config.embedding.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Embedding request failed (${response.status} ${response.statusText}): ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== config.embedding.dimensions) {
    throw new Error(
      `Embedding response shape unexpected (expected a ${config.embedding.dimensions}-dim vector)`
    );
  }
  return vector;
}

module.exports = { embed, TASK_PREFIX };
