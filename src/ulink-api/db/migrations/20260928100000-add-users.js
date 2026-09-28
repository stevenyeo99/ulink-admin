'use strict';

// Console users (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, step 7). Manual
// username + password login, JWT sessions. One role for now — super_admin — kept as a checked text
// column so later roles (CSR, Ops, JD2, Manager) are one constraint change, not a new table.
// No user is seeded: create the first one with `npm run user:create` (asks for the password).

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await queryInterface.tableExists('ulink_users'))) {
      await queryInterface.createTable('ulink_users', {
        id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        username: { type: Sequelize.TEXT, allowNull: false, unique: true },
        name: { type: Sequelize.TEXT, allowNull: true },
        passwordHash: { type: Sequelize.TEXT, allowNull: false, field: 'password_hash' },
        role: { type: Sequelize.TEXT, allowNull: false },
        isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
        lastLoginAt: { type: Sequelize.DATE, allowNull: true, field: 'last_login_at' },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'created_at' },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW, field: 'updated_at' },
      });
    }
    await queryInterface.sequelize.query(`
      ALTER TABLE ulink_users DROP CONSTRAINT IF EXISTS ulink_users_role_check;
      ALTER TABLE ulink_users ADD CONSTRAINT ulink_users_role_check CHECK (role IN ('super_admin'));
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ulink_users');
  },
};
