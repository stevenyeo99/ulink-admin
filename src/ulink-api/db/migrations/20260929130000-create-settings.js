'use strict';

// Small key/value store for switches changed from the console (not .env: they're business choices
// Ulink makes, and change without a restart). First two, both off by default (2026-09-29):
// - stpBlockOnReviewPoints: a claim with an open review point (AI unsure, rule hold, …) never goes STP.
// - holdUnsureMissingDocsEmail: when the AI is unsure a document is missing, the customer's
//   missing-documents email waits for a person instead of going out straight away.
// Read through modules/settings/settings.js, which supplies the defaults.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_settings', {
      key: { type: Sequelize.TEXT, primaryKey: true },
      value: { type: Sequelize.JSONB, allowNull: false },
      updatedBy: { type: Sequelize.TEXT, allowNull: true, field: 'updated_by' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_settings');
  },
};
