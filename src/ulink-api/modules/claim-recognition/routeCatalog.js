const { ClaimRoute } = require('../../db/models');

/**
 * DB-backed route catalog (ulink_claim_routes). Adding a new claim type later is a new
 * row (route_key, insurer/claim_type match hints, its own extraction_schema) — this
 * module and the recognition service never change for that.
 */
async function getEnabledRoutes() {
  return ClaimRoute.findAll({ where: { enabled: true } });
}

module.exports = { getEnabledRoutes };
