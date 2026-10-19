'use strict';

// Documents uploaded on an API case page (origin UPLOAD) are stored on the case and read before they go to the IAS
// console, so they have no barcode yet. Console images (origin CONSOLE) always have one.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.changeColumn('ulink_case_documents', 'barcode_id', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      await queryInterface.sequelize.query('ALTER TABLE ulink_case_documents DROP CONSTRAINT ulink_case_documents_origin_check', { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE ulink_case_documents ADD CONSTRAINT ulink_case_documents_origin_check CHECK (origin IN ('CONSOLE', 'UPLOAD'))",
        { transaction }
      );
    });
  },

  // Fails while an uploaded document exists: those rows are case evidence, never deleted here.
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('ALTER TABLE ulink_case_documents DROP CONSTRAINT ulink_case_documents_origin_check', { transaction });
      await queryInterface.sequelize.query(
        "ALTER TABLE ulink_case_documents ADD CONSTRAINT ulink_case_documents_origin_check CHECK (origin IN ('CONSOLE'))",
        { transaction }
      );
      await queryInterface.changeColumn('ulink_case_documents', 'barcode_id', { type: Sequelize.TEXT, allowNull: false }, { transaction });
    });
  },
};
