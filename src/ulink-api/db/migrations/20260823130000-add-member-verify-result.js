'use strict';

// Member Verification module (calls IAS GET_MEMBER_INFO_API, see
// modules/member-verification/). Mirrors 20260822140000-add-document-check-result.js.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'member_verify_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    // Full raw IAS GET_MEMBER_INFO_API response (member/policies/memberPlans, including the
    // benefit-catalog data member_verify_result deliberately omits) — kept verbatim because
    // the planned ias-claim-creation job needs fields off it (MEPL_OID, PLAN_ID, bank
    // details, etc.) without re-querying IAS a second time for the same case.
    await queryInterface.addColumn('ulink_cases', 'ias_member_info_response', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'member_verify_result');
    await queryInterface.removeColumn('ulink_cases', 'ias_member_info_response');
  },
};
