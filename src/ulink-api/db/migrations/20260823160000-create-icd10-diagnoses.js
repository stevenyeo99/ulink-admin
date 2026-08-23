'use strict';

// ICD-10 diagnosis RAG (modules/icd10/) — mirrors IAS's own RT_DIAGNOSIS table (see
// docs/imp/day1/IAS_RAG/DIAG_CLASS_ICD10_2012_STAGING.xlsx, ~39,793 rows), embedded via
// text-embedding-nomic-embed-text-v1.5 for nearest-neighbor lookup at claim-preparation
// time. pgvector ('vector' extension) is already installed on this Supabase instance —
// verified directly (select * from pg_extension) before writing this migration.
//
// Raw SQL throughout, not queryInterface.createTable/Sequelize model — Sequelize has no
// `vector` DataType, so this table is defined and queried via sequelize.query() everywhere,
// same escape hatch already used for this repo's other ORM-can't-express-this queries.
//
// NOTE: the HNSW index created below is later dropped by
// 20260823190000-drop-icd10-hnsw-index.js — verified to give wrong nearest-neighbor
// results on this dataset. modules/icd10/lookup.js relies on exact search instead. Left
// here (not edited out) since this migration is already applied; see that later migration
// for the full story.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('create extension if not exists vector');

    await queryInterface.sequelize.query(`
      create table ulink_icd10_diagnoses (
        diag_oid bigint primary key,
        diag_code text not null,
        diag_desc text not null,
        embedding vector(768),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await queryInterface.sequelize.query(
      'create index ulink_icd10_diagnoses_diag_code_idx on ulink_icd10_diagnoses (diag_code)'
    );
    await queryInterface.sequelize.query(
      `create index ulink_icd10_diagnoses_embedding_hnsw_idx
       on ulink_icd10_diagnoses using hnsw (embedding vector_cosine_ops)`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('drop table if exists ulink_icd10_diagnoses');
  },
};
