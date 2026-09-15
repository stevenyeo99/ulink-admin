const { StpLimit } = require('../../db/models');

/**
 * STP (straight-through processing) eligibility — true if the case's total presented amount
 * is at or under the matching ulink_stp_limits row for its route+currency. No matching row
 * means no confirmed limit for this route/currency combination — defaults to false (not
 * STP, falls back to the existing manual-review path) rather than guessing a claim through
 * straight-through processing without a real configured limit.
 */
async function isStp({ routeKey, currency, presentedAmt }) {
  if (routeKey == null || currency == null || presentedAmt == null) return false;

  const limit = await StpLimit.findOne({ where: { routeKey, currency } });
  if (!limit) return false;

  return presentedAmt <= Number(limit.amountLimit);
}

module.exports = { isStp };
