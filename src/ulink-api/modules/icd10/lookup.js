const { sequelize } = require('../../db/models');
const { embed, TASK_PREFIX } = require('./embeddingClient');

/**
 * Nearest-neighbor ICD-10 candidates for a free-text diagnosis/illness description.
 * Retrieval only — picking the single best candidate (or deciding none fit) is left to
 * whatever calls this (modules/ias-claim-preparation/diagnosisPicker.js's LLM re-rank step),
 * not this module's job.
 *
 * Deliberately an exact (sequential-scan) nearest-neighbor search, no vector index —
 * see db/migrations/20260823190000-drop-icd10-hnsw-index.js for why: the HNSW index this
 * table originally had gave verifiably wrong top-K results (missed the true best match even
 * at high ef_search), and this runs once per case inside a background batch job, not a
 * live/interactive feature, so the ~7-10s exact-scan cost is a fine trade for a correctness
 * guarantee an approximate index couldn't give here.
 *
 * Raw SQL, not the Sequelize query builder — pgvector's `<=>` distance operator and vector
 * literal casting aren't expressible through it, same reasoning as the migration that
 * created this table.
 */
async function findCandidates(freeText, { topK = 5 } = {}) {
  const queryEmbedding = await embed(freeText, { taskPrefix: TASK_PREFIX.QUERY });
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const rows = await sequelize.query(
    `select diag_oid, diag_code, diag_desc, 1 - (embedding <=> :vec::vector) as similarity
     from ulink_icd10_diagnoses
     order by embedding <=> :vec::vector
     limit :topK`,
    { replacements: { vec: vectorLiteral, topK }, type: sequelize.QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    diagOid: row.diag_oid,
    diagCode: row.diag_code,
    diagDesc: row.diag_desc,
    similarity: row.similarity,
  }));
}

module.exports = { findCandidates };
