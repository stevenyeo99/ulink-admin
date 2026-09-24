'use strict';

// API cases (claims listed by IAS get_claim_api) share ulink_cases with email cases, so every
// case now says which workflow owns it — see docs/imp/day1/api-case-workflow.md section 3.
//
// - source: 'EMAIL' (default, so every existing row stays an email case) or 'API'.
// - ulink_cases_source_status_match: an API case can only hold API_* statuses and an email
//   case never can. Email jobs select by exact email statuses, so this is what keeps them
//   from ever picking up an API case — no email job query needs a source filter.
// - Unique claim_no / tpa_case_number among API cases: one IAS claim becomes at most one
//   case, even if two intake runs overlap. Email cases' claim_no is left unconstrained.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('ulink_cases', 'source', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'EMAIL',
      }, { transaction });
      await queryInterface.addColumn('ulink_cases', 'tpa_case_number', {
        type: Sequelize.TEXT,
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn('ulink_cases', 'ias_api_claim', {
        type: Sequelize.JSONB,
        allowNull: true,
      }, { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE ulink_cases
           ADD CONSTRAINT ulink_cases_source_check CHECK (source IN ('EMAIL', 'API')),
           ADD CONSTRAINT ulink_cases_source_status_match CHECK ((source = 'API') = (current_status LIKE 'API\\_%'))`,
        { transaction }
      );

      await queryInterface.addIndex('ulink_cases', ['claim_no'], {
        name: 'ulink_cases_api_claim_no_unique',
        unique: true,
        where: { source: 'API' },
        transaction,
      });
      await queryInterface.addIndex('ulink_cases', ['tpa_case_number'], {
        name: 'ulink_cases_api_tpa_case_number_unique',
        unique: true,
        where: { source: 'API' },
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('ulink_cases', 'ulink_cases_api_tpa_case_number_unique', { transaction });
      await queryInterface.removeIndex('ulink_cases', 'ulink_cases_api_claim_no_unique', { transaction });
      await queryInterface.sequelize.query(
        `ALTER TABLE ulink_cases
           DROP CONSTRAINT ulink_cases_source_status_match,
           DROP CONSTRAINT ulink_cases_source_check`,
        { transaction }
      );
      await queryInterface.removeColumn('ulink_cases', 'ias_api_claim', { transaction });
      await queryInterface.removeColumn('ulink_cases', 'tpa_case_number', { transaction });
      await queryInterface.removeColumn('ulink_cases', 'source', { transaction });
    });
  },
};
