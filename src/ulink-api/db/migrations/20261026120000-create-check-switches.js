'use strict';

// AI checklist switches (SYSTEM_5 phase B, docs/imp/CR/SYSTEM_5/PRD/SYSTEM_5_PRD.md 4.4 / 5): a super admin switches a
// check off or on, with a reason. Append-only: every change is a row, the latest row for a code is its state (no row =
// on), and the rows are the full history (Q4). Read through modules/ai-checklist/switches.js.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_check_switches', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      code: { type: Sequelize.TEXT, allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      changedBy: { type: Sequelize.TEXT, allowNull: false, field: 'changed_by' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
    });
    await queryInterface.addIndex('ulink_check_switches', ['code', 'created_at'], { name: 'ulink_check_switches_code_created_at' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_check_switches');
  },
};
