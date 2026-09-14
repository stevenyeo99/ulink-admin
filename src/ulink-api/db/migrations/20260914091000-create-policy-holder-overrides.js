'use strict';

// Per-policyholder overrides on the base exclusion clauses (docs/imp/demo/20260914/samples/
// AYAHealth_Special Conditions and Benefit Clarifications...xlsx) — e.g. TOB's group policy
// permits outpatient psychiatric treatment that the base AYA Health wording (clause 6.35)
// excludes generally. Checked via modules/policy-exclusion/overrideLookup.js's exact/contains
// match on policy.company_name, same style as member-verification/checks.js's
// compareBankName — no embedding, this table is small and matched on a name, not free text.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_policy_holder_overrides', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      // Null route_key/policyHolderName means "applies broadly" (mirrors the source xlsx's
      // own blank cells, e.g. the "Both individual and group policies" rows).
      routeKey: { type: Sequelize.TEXT, allowNull: true, field: 'route_key' },
      policyHolderName: { type: Sequelize.TEXT, allowNull: true, field: 'policy_holder_name' },
      coverageArea: { type: Sequelize.TEXT, allowNull: false, field: 'coverage_area' },
      note: { type: Sequelize.TEXT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
    });

    await queryInterface.addIndex('ulink_policy_holder_overrides', ['policy_holder_name']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_policy_holder_overrides');
  },
};
