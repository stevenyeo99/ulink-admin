'use strict';

// STP rules configurable from the console Settings page (enhancement status point 7, demo scope,
// 2026-09-29). Replaces ulink_stp_limits (one amount per route+currency) with:
//
// - ulink_stp_rules: one row per case type (EMAIL / API) + IAS benefit type (IP / OP / DT / VS) +
//   currency — is STP allowed for it, and up to what amount. Keyed on the IAS benefit type the claim
//   is actually submitted with (benefitPicker.js → payload BenefitType), not the claim form's
//   "type of patient", which can't say Dental / Vision.
// - ulink_stp_blocked_diagnoses: ICD-10 code prefixes that never go STP. R69 is seeded: it is the
//   code used when no diagnosis could be found (diagnosisPicker.js DEFAULT_DIAGNOSIS).
//
// Seeded amounts are DEMO values (different per case type, to show the difference), not business rules.

const BENEFIT_TYPES = ['IP', 'OP', 'DT', 'VS'];
const DEMO_RULES = {
  EMAIL: { IP: [false, null], OP: [true, 50000], DT: [true, 30000], VS: [true, 30000] },
  API: { IP: [false, null], OP: [true, 100000], DT: [true, 50000], VS: [false, null] },
};

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const id = { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') };
      const timestamps = {
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
      };

      await queryInterface.dropTable('ulink_stp_limits', { transaction });

      await queryInterface.createTable('ulink_stp_rules', {
        id,
        caseSource: { type: Sequelize.TEXT, allowNull: false, field: 'case_source' },
        benefitType: { type: Sequelize.TEXT, allowNull: false, field: 'benefit_type' },
        currency: { type: Sequelize.TEXT, allowNull: false },
        stpAllowed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false, field: 'stp_allowed' },
        amountLimit: { type: Sequelize.DECIMAL, allowNull: true, field: 'amount_limit' },
        ...timestamps,
      }, { transaction });
      await queryInterface.sequelize.query(
        `ALTER TABLE ulink_stp_rules
           ADD CONSTRAINT ulink_stp_rules_case_source_check CHECK (case_source IN ('EMAIL', 'API')),
           ADD CONSTRAINT ulink_stp_rules_amount_limit_check CHECK (amount_limit IS NULL OR amount_limit >= 0),
           ADD CONSTRAINT ulink_stp_rules_unique UNIQUE (case_source, benefit_type, currency)`,
        { transaction }
      );

      await queryInterface.createTable('ulink_stp_blocked_diagnoses', {
        id,
        codePrefix: { type: Sequelize.TEXT, allowNull: false, unique: true, field: 'code_prefix' },
        note: { type: Sequelize.TEXT, allowNull: true },
        ...timestamps,
      }, { transaction });

      const now = new Date();
      await queryInterface.bulkInsert('ulink_stp_rules', Object.entries(DEMO_RULES).flatMap(([source, rules]) =>
        BENEFIT_TYPES.map((type) => ({
          case_source: source,
          benefit_type: type,
          currency: 'MMK',
          stp_allowed: rules[type][0],
          amount_limit: rules[type][1],
          created_at: now,
          updated_at: now,
        }))), { transaction });
      await queryInterface.bulkInsert('ulink_stp_blocked_diagnoses', [
        { code_prefix: 'R69', note: 'Diagnosis could not be found (default code)', created_at: now, updated_at: now },
      ], { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ulink_stp_blocked_diagnoses', { transaction });
      await queryInterface.dropTable('ulink_stp_rules', { transaction });
      await queryInterface.createTable('ulink_stp_limits', {
        id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        routeKey: { type: Sequelize.TEXT, allowNull: false, field: 'route_key' },
        currency: { type: Sequelize.TEXT, allowNull: false },
        amountLimit: { type: Sequelize.DECIMAL, allowNull: false, field: 'amount_limit' },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
      }, { transaction });
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX "ulink_stp_limits_route_key_currency" ON "ulink_stp_limits" ("route_key", "currency")',
        { transaction }
      );
      const now = new Date();
      await queryInterface.bulkInsert('ulink_stp_limits', [
        { route_key: 'ayas_member_claim', currency: 'MMK', amount_limit: 50000, created_at: now, updated_at: now },
      ], { transaction });
    });
  },
};
