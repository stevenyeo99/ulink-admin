'use strict';

// Maternity (owner, 2026-10-29): IAS benefit type MAT gets its own STP rule, one row per case type, in MMK, next to
// IP / OP / DT / VS (20260929100000-stp-rules). Not allowed and no amount limit until the team sets them on the STP
// settings page. Prenatal is submitted as IP/MAT, so it follows the IP row. A row already there is left as it is.
// down: removes the MAT rows (with whatever the team set on them).

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `INSERT INTO ulink_stp_rules (case_source, benefit_type, currency, stp_allowed, amount_limit, created_at, updated_at)
       VALUES ('EMAIL', 'MAT', 'MMK', false, NULL, now(), now()), ('API', 'MAT', 'MMK', false, NULL, now(), now())
       ON CONFLICT (case_source, benefit_type, currency) DO NOTHING`
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM ulink_stp_rules WHERE benefit_type = 'MAT' AND currency = 'MMK'");
  },
};
