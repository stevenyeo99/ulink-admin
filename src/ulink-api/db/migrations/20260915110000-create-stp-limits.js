'use strict';

// STP (straight-through processing) amount limits per route/currency. Read by
// modules/ias-claim-preparation/stpEligibility.js to decide Case.isStp (and, from that,
// the CL_CLAIM_API payload's isValidation/isCSR flags — see payloadBuilder.js). Small,
// hand-curated table, same shape/reasoning as ulink_policy_holder_overrides.
//
// Seeded value (50,000 MMK) is a DEMO threshold, chosen to produce a believable STP/non-STP
// split across the existing complete sample cases (day1/complete/1=23,000,
// 20260826/complete/2=32,500 -> STP; day1/complete/2=54,690, 20260826/complete/1=145,000 ->
// non-STP) — NOT a confirmed production business rule. Update this row once business
// confirms the real limit.

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await queryInterface.tableExists('ulink_stp_limits'))) {
      await queryInterface.createTable('ulink_stp_limits', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        routeKey: { type: Sequelize.TEXT, allowNull: false, field: 'route_key' },
        currency: { type: Sequelize.TEXT, allowNull: false },
        amountLimit: { type: Sequelize.DECIMAL, allowNull: false, field: 'amount_limit' },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
      });
    }

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ulink_stp_limits_route_key_currency" ON "ulink_stp_limits" ("route_key", "currency")'
    );

    const now = new Date();
    await queryInterface.bulkInsert('ulink_stp_limits', [
      {
        route_key: 'ayas_member_claim',
        currency: 'MMK',
        amount_limit: 50000,
        created_at: now,
        updated_at: now,
      },
    ], { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_stp_limits');
  },
};
