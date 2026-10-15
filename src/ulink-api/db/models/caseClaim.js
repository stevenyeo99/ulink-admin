// Who is reviewing a case right now — see migrations/20261015130000-create-case-claims.js and modules/case-claim.
module.exports = (sequelize, DataTypes) => {
  const CaseClaim = sequelize.define(
    'CaseClaim',
    {
      caseId: { type: DataTypes.UUID, primaryKey: true },
      username: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: true },
      claimedAt: { type: DataTypes.DATE, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: 'ulink_case_claims', timestamps: false }
  );
  return CaseClaim;
};
