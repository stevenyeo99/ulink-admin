// A reviewer's own checklist line on one case (SYSTEM_4 E4-28) — see migrations/20261016120000-create-case-requests.js
// and modules/case-requests/requests.js. Open while doneAt is null.
module.exports = (sequelize, DataTypes) => sequelize.define(
  'CaseRequest',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    caseId: { type: DataTypes.UUID, allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    createdBy: { type: DataTypes.STRING, allowNull: false },
    doneBy: { type: DataTypes.STRING, allowNull: true },
    doneAt: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'ulink_case_requests' }
);
