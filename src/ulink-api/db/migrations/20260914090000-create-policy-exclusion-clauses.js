'use strict';

// Policy exclusion RAG (modules/policy-exclusion/) — same shape as
// 20260823160000-create-icd10-diagnoses.js: source clauses embedded via
// text-embedding-nomic-embed-text-v1.5 for nearest-neighbor retrieval, judged by an LLM
// call afterward (modules/policy-exclusion/judge.js), never a plain code lookup — SOP §6.3
// exclusions are free-text legal clauses, not codes (see
// docs/imp/demo/20260914/JD1_Checklist_SOP_vs_Current_System.md item 7).
//
// `route_key` scopes clauses to one product (e.g. 'ayas_member_claim') — plain string
// matching modules/claim-recognition's Case.recognizedType, not a FK, same reasoning as
// ulink_claim_routes.routeKey. A second product later is a second batch of rows with its
// own route_key, not a schema change.
//
// No HNSW index — same reasoning as icd10 (20260823190000-drop-icd10-hnsw-index.js:
// approximate index gave wrong top-K on that dataset), even more justified here: this
// table holds ~50 rows per product, an exact scan costs nothing at that size.
//
// Raw SQL, not queryInterface.createTable — Sequelize has no `vector` DataType, same
// escape hatch as ulink_icd10_diagnoses.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      create table ulink_policy_exclusion_clauses (
        id uuid primary key default gen_random_uuid(),
        route_key text not null,
        clause_ref text not null,
        clause_text text not null,
        embedding vector(768),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await queryInterface.sequelize.query(
      'create index ulink_policy_exclusion_clauses_route_key_idx on ulink_policy_exclusion_clauses (route_key)'
    );
    await queryInterface.sequelize.query(
      'create unique index ulink_policy_exclusion_clauses_route_clause_idx on ulink_policy_exclusion_clauses (route_key, clause_ref)'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('drop table if exists ulink_policy_exclusion_clauses');
  },
};
