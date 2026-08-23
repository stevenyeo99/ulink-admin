'use strict';

// Per-route CC recipient for outbound customer-facing emails (email-sender), so Ulink's own
// team gets visibility per insurer/claim-type route rather than one shared global address.
// Left null by default — no real internal address to seed; set it directly per route once
// known, e.g.:
//   update ulink_claim_routes set cc_email = 'team@example.com' where route_key = 'ayas_member_claim';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_claim_routes', 'cc_email', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_claim_routes', 'cc_email');
  },
};
