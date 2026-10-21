'use strict';

// SYSTEM_4 E4-06 follow-up (code review, 2026-10-21): IAS's ICD-10 list has the parent code I25.1 (atherosclerotic heart
// disease) and its children I25.10 to I25.13. 20261021100000-chronic-never-stp-diagnoses blocked only I25.10 and
// I25.11, so a claim coded I25.1, I25.12 or I25.13 could still go STP. I25.1 is a prefix of all of them. The two
// narrower rows stay (they name the sheet's own codes). A prefix already on the list is left as it is.
// down: removes the row only if this migration inserted it (same note).

const CODE = 'I25.1';
const NOTE = 'Chronic: atherosclerotic heart disease, all I25.1x codes (sheet: I25.10, I25.110, I25.118, I25.119)';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `INSERT INTO ulink_stp_blocked_diagnoses (code_prefix, note, created_at, updated_at)
       VALUES (:code, :note, now(), now()) ON CONFLICT (code_prefix) DO NOTHING`,
      { replacements: { code: CODE, note: NOTE } }
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM ulink_stp_blocked_diagnoses WHERE code_prefix = :code AND note = :note', {
      replacements: { code: CODE, note: NOTE },
    });
  },
};
