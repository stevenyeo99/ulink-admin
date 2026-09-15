'use strict';

// Console upload job (modules/console-upload/) — copies a cleared case's documents into a
// dedicated shared folder (CONSOLE_UPLOAD_ROOT, separate from STORAGE_ROOT) and generates a
// barcode carried through to ias-claim-preparation's CL_CLAIM_API payload. Mirrors
// 20260823130000-add-member-verify-result.js's shape.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'console_upload_result', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('ulink_cases', 'console_barcode', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'console_upload_result');
    await queryInterface.removeColumn('ulink_cases', 'console_barcode');
  },
};
