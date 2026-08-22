'use strict';

// Document Checking module - Lego block 3 (checklist comparisons over Case.extractedFields,
// no LLM/external call). See docs/imp/day1/drt-claim-demo-progress.md.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'document_check_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'document_check_result');
  },
};
