'use strict';

// A reviewer's own checklist line on one case (SYSTEM_4 E4-28): what a person asked for that the predefined checklist
// does not cover — e.g. "Need to fill treatment date in the eye test record". Open until a person marks it done (the
// AI cannot check a free line); a case with open lines stops for a person after every re-check.
// modules/case-requests/requests.js.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_case_requests', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      caseId: { type: Sequelize.UUID, allowNull: false, field: 'case_id', references: { model: 'ulink_cases', key: 'id' }, onDelete: 'CASCADE' },
      text: { type: Sequelize.TEXT, allowNull: false },
      createdBy: { type: Sequelize.STRING, allowNull: false, field: 'created_by' },
      doneBy: { type: Sequelize.STRING, allowNull: true, field: 'done_by' },
      doneAt: { type: Sequelize.DATE, allowNull: true, field: 'done_at' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
    });
    await queryInterface.addIndex('ulink_case_requests', ['case_id', 'done_at'], { name: 'ulink_case_requests_case_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_case_requests');
  },
};
