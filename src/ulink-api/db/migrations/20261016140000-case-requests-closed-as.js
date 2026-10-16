'use strict';

// SYSTEM_4 E4-29: why a reviewer's line was closed — done (the documents arrived), removed (no longer needed) or reset
// (the case was reprocessed). Lines closed before this column are left null.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_case_requests', 'closed_as', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.sequelize.query("ALTER TABLE ulink_case_requests ADD CONSTRAINT ulink_case_requests_closed_as_check CHECK (closed_as IN ('done', 'removed', 'reset'))");
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_case_requests', 'closed_as');
  },
};
