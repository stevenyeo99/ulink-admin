'use strict';

// api-material-download's output for an API case: the scanId it searched, the folder the
// console images were unpacked into, and every barcode (submission) with its files. The next
// job (OCR) reads the files from here — see docs/imp/day1/api-case-workflow.md section 6.3.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'api_materials_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'api_materials_result');
  },
};
