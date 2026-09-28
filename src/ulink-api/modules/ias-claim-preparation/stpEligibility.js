const { StpLimit } = require('../../db/models');

/**
 * STP (straight-through processing) eligibility — true if the case's total presented amount
 * is at or under the matching ulink_stp_limits row for its route+currency. No matching row
 * means no confirmed limit for this route/currency combination — defaults to false (not
 * STP, falls back to the existing manual-review path) rather than guessing a claim through
 * straight-through processing without a real configured limit.
 */
async function stpDecision({ routeKey, currency, presentedAmt }) {
  // total / limit / currency are kept so the decision can be explained later (assessment summary).
  const decision = (isStp, limit = null) => ({ isStp, total: presentedAmt ?? null, limit, currency: currency ?? null });
  if (routeKey == null || currency == null || presentedAmt == null) return decision(false);

  const limit = await StpLimit.findOne({ where: { routeKey, currency } });
  if (!limit) return decision(false);

  return decision(presentedAmt <= Number(limit.amountLimit), Number(limit.amountLimit));
}

module.exports = { stpDecision };
