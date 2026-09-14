const { sequelize } = require('../../db/models');
const { embed, TASK_PREFIX } = require('../icd10/embeddingClient');

/**
 * Nearest-neighbor exclusion-clause candidates for a free-text diagnosis/treatment
 * description, scoped to one product (`routeKey`, e.g. 'ayas_member_claim' — matches
 * Case.recognizedType). Retrieval only, same split as modules/icd10/lookup.js — picking
 * (or rejecting) a candidate is judge.js's job, not this module's.
 *
 * Exact scan, no vector index — same reasoning as icd10/lookup.js's own comment, more so
 * here: this table holds ~50 rows per product, not tens of thousands.
 */
async function findCandidates(freeText, routeKey, { topK = 5 } = {}) {
  const queryEmbedding = await embed(freeText, { taskPrefix: TASK_PREFIX.QUERY });
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const rows = await sequelize.query(
    `select clause_ref, clause_text, 1 - (embedding <=> :vec::vector) as similarity
     from ulink_policy_exclusion_clauses
     where route_key = :routeKey
     order by embedding <=> :vec::vector
     limit :topK`,
    { replacements: { vec: vectorLiteral, routeKey, topK }, type: sequelize.QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    clauseRef: row.clause_ref,
    clauseText: row.clause_text,
    similarity: row.similarity,
  }));
}

module.exports = { findCandidates };
