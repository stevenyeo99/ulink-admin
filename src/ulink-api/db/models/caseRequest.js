// A reviewer's own checklist line on one case (SYSTEM_4 E4-28) — see migrations/20261016120000-create-case-requests.js
// and modules/case-requests/requests.js. Open while doneAt is null; closedAs says why it closed (E4-29).
// CLOSED_AS must match the table's check constraint (tests/caseRequests.test.js guards that).
const CLOSED_AS = ['done', 'removed', 'reset'];

module.exports = (sequelize, DataTypes) => {
  const CaseRequest = sequelize.define(
    'CaseRequest',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      caseId: { type: DataTypes.UUID, allowNull: false },
      text: { type: DataTypes.TEXT, allowNull: false },
      createdBy: { type: DataTypes.STRING, allowNull: false },
      doneBy: { type: DataTypes.STRING, allowNull: true },
      doneAt: { type: DataTypes.DATE, allowNull: true },
      closedAs: { type: DataTypes.STRING, allowNull: true, validate: { isIn: [CLOSED_AS] } },
    },
    { tableName: 'ulink_case_requests' }
  );
  CaseRequest.CLOSED_AS = CLOSED_AS;
  return CaseRequest;
};
