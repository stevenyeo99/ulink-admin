'use strict';

// Never-STP benefit heads (owner, 2026-11-10): a voucher submitted with a benefit type + head on this list never goes
// STP, while the benefit type rule (ulink_stp_rules) still decides the other vouchers of that type. Same idea as the
// never-STP diagnosis list (ulink_stp_blocked_diagnoses), edited on the STP settings page. Seeded: OP/VACC (vaccination),
// so OP can go STP within its limit but a vaccination voucher waits for a person.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable('ulink_stp_blocked_benefits', {
        id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        benefitType: { type: Sequelize.TEXT, allowNull: false, field: 'benefit_type' },
        benefitHead: { type: Sequelize.TEXT, allowNull: false, field: 'benefit_head' },
        note: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
      }, { transaction });
      await queryInterface.sequelize.query(
        'ALTER TABLE ulink_stp_blocked_benefits ADD CONSTRAINT ulink_stp_blocked_benefits_unique UNIQUE (benefit_type, benefit_head)',
        { transaction }
      );
      await queryInterface.sequelize.query(
        `INSERT INTO ulink_stp_blocked_benefits (benefit_type, benefit_head, note, created_at, updated_at)
         VALUES ('OP', 'VACC', 'Vaccination: a person approves', now(), now())`,
        { transaction }
      );
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) => queryInterface.dropTable('ulink_stp_blocked_benefits', { transaction }));
  },
};
