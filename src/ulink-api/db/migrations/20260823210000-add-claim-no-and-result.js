'use strict';

// ias-claim-creation module — the real assigned claim number (claim_no) gets its own
// queryable column, not buried only in the JSONB blob — it's the actual deliverable of this
// whole pipeline. ias_claim_result stores the raw CL_CLAIM_API response verbatim (success
// payload or error), mirroring ias_member_info_response's "store the raw thing for audit"
// precedent (see 20260823130000-add-member-verify-result.js).

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'claim_no', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('ulink_cases', 'ias_claim_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'claim_no');
    await queryInterface.removeColumn('ulink_cases', 'ias_claim_result');
  },
};
