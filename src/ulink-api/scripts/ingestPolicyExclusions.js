'use strict';

// One-off data load, not an HTTP job/cron endpoint — run manually:
//   node scripts/ingestPolicyExclusions.js
//
// Loads scripts/seeds/ayaHealthExclusionClauses.js (embedded into ulink_policy_exclusion_
// clauses, same embed-and-upsert shape as scripts/ingestIcd10Diagnoses.js) and
// scripts/seeds/policyHolderOverrides.js (plain insert into ulink_policy_holder_overrides,
// no embedding — that table is matched by exact/contains name, not vector similarity).
//
// No concurrency pool like ingestIcd10Diagnoses.js — that script handles ~40,000 rows and
// needs one; this handles ~55, sequential is simpler and plenty fast.
//
// Resumable the same way: clauses upsert on (route_key, clause_ref) conflict, so a re-run
// is safe. Overrides are wiped and reloaded whole each run — the table is small and fully
// owned by this seed file, no runtime-written rows to preserve.

const { sequelize, PolicyHolderOverride } = require('../db/models');
const { embed, TASK_PREFIX } = require('../modules/icd10/embeddingClient');
const { clauses } = require('./seeds/ayaHealthExclusionClauses');
const { overrides } = require('./seeds/policyHolderOverrides');

async function upsertClause({ routeKey, clauseRef, clauseText }) {
  const embedding = await embed(clauseText, { taskPrefix: TASK_PREFIX.DOCUMENT });
  const vectorLiteral = `[${embedding.join(',')}]`;

  await sequelize.query(
    `insert into ulink_policy_exclusion_clauses (route_key, clause_ref, clause_text, embedding, updated_at)
     values (:routeKey, :clauseRef, :clauseText, :vec::vector, now())
     on conflict (route_key, clause_ref) do update set
       clause_text = excluded.clause_text,
       embedding = excluded.embedding,
       updated_at = now()`,
    { replacements: { routeKey, clauseRef, clauseText, vec: vectorLiteral } }
  );
}

async function ingestClauses() {
  console.log(`Embedding ${clauses.length} exclusion clauses...`);
  let done = 0;
  let failed = 0;
  for (const clause of clauses) {
    try {
      await upsertClause(clause);
    } catch (error) {
      failed += 1;
      console.error(`Failed clause ${clause.routeKey}/${clause.clauseRef}:`, error.message);
    }
    done += 1;
  }
  console.log(`Clauses: ${done} processed, ${failed} failed.`);
}

async function ingestOverrides() {
  console.log(`Loading ${overrides.length} policy-holder overrides...`);
  await PolicyHolderOverride.destroy({ where: {}, truncate: true });
  await PolicyHolderOverride.bulkCreate(overrides);
  console.log(`Overrides: ${overrides.length} loaded.`);
}

async function main() {
  await ingestClauses();
  await ingestOverrides();
}

main()
  .catch((error) => {
    console.error('Ingestion failed:', error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
