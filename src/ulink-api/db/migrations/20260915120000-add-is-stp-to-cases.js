'use strict';

// Whether this case's presented amount qualified for STP (straight-through processing)
// under ulink_stp_limits — computed once by ias-claim-preparation (see
// modules/ias-claim-preparation/stpEligibility.js) and carried onto the CL_CLAIM_API
// payload's isValidation/isCSR flags. Nullable — null means "not evaluated yet", not
// "evaluated false".

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ulink_cases', 'is_stp', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'is_stp');
  },
};
