'use strict';

// Removes the HNSW vector index added in 20260823160000-create-icd10-diagnoses.js.
//
// Verified directly (not assumed) that it had poor recall on this dataset at every
// buildable ef_search level: querying "Coughing dizziness" never surfaced the true best
// match (R42 "Dizziness and giddiness", cosine similarity 0.671) even at ef_search=200 —
// it returned unrelated "poisoning by narcotics" entries around similarity 0.58 instead.
// ef_search=400 did surface the right answer, but by then the index scan took ~7s anyway —
// no faster than just not having an index. A rebuild with better build-time parameters
// (m=32, ef_construction=200) was attempted and got killed by Supabase's 2-minute
// statement_timeout mid-build.
//
// Decision: don't chase index tuning further. modules/icd10/lookup.js now relies on exact
// (sequential-scan) nearest-neighbor search instead — this table is a fixed ~39,793-row
// reference set queried once per case inside a background batch job
// (ias-claim-preparation), not a live/interactive feature, so the ~7-10s exact-scan cost
// is a non-issue and buys a correctness guarantee an approximate index can't.

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('drop index if exists ulink_icd10_diagnoses_embedding_hnsw_idx');
  },

  async down() {
    // Deliberately not restoring the HNSW index — see the comment above for why. If vector
    // search performance ever becomes a real bottleneck, that's a fresh design decision
    // (different index type/parameters, direct non-pooled connection for the build, etc.),
    // not a revert of this migration.
  },
};
