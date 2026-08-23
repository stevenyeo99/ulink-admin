'use strict';

// ias-claim-preparation module (builds the CL_CLAIM_API request payload once a case is
// MEMBER_VERIFIED). Mirrors 20260822140000-add-document-check-result.js /
// 20260823130000-add-member-verify-result.js.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'ias_claim_payload', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'ias_claim_payload');
  },
};
