'use strict';

// Who is reviewing a case right now (SYSTEM_4 E4-22, E4b): one row per claimed case, so two people don't correct or
// decide the same case at once. Its own table, not columns on ulink_cases — a write to the case row changes its
// updated_at, which the review queue and the pipeline order cases by. A claim expires (expires_at) unless the holder
// keeps acting on the case; see modules/case-claim/claim.js.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ulink_case_claims', {
      caseId: { type: Sequelize.UUID, primaryKey: true, field: 'case_id', references: { model: 'ulink_cases', key: 'id' }, onDelete: 'CASCADE' },
      username: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: true },
      claimedAt: { type: Sequelize.DATE, allowNull: false, field: 'claimed_at' },
      expiresAt: { type: Sequelize.DATE, allowNull: false, field: 'expires_at' },
    });
    await queryInterface.addIndex('ulink_case_claims', ['username'], { name: 'ulink_case_claims_username_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ulink_case_claims');
  },
};
