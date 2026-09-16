'use strict';

// ias-claim-preparation's diagnosis/benefit LLM picks previously discarded their own
// confidence score and the candidate list they were shown, keeping only the final code in
// Case.iasClaimPayload — no way to see afterward why a code was picked or what else was
// considered. Separate column, not folded into ias_claim_payload: that column is the literal
// IAS-bound submission payload (see payloadBuilder.js's header comment), this is internal
// diagnostic metadata that must never leak into it.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'claim_prep_meta', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'claim_prep_meta');
  },
};
