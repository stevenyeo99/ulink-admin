/**
 * SOP §6.5 (Available Benefit Balance) — informational only, not a gate, per SOP ("provide
 * it for assessment"). Real usage-tracked balance needs a new IAS/balance-tracking
 * integration that doesn't exist yet (2026-09-14 decision: ship a placeholder now, full
 * integration later). This is a straight passthrough of the plan's own filed limits
 * (memberPlans[0].coverageLimits[]), NOT a computed remaining balance — every entry is
 * explicitly labeled as such so JD2 never mistakes it for a live, usage-adjusted figure.
 */
const LIMIT_NOTE = 'Plan limit as filed — not adjusted for prior usage; real-time balance integration pending.';

function summarizeBenefitLimits(memberPlansRaw) {
  const plan = memberPlansRaw?.[0];
  const coverageLimits = plan?.coverageLimits || [];

  return coverageLimits.map((limit) => ({
    limitType: limit.limit_type_code ?? null,
    limitTypeDesc: limit.limit_type_desc ?? null,
    benefits: (limit.benefits || []).map((b) => ({
      type: b.benefit_type_code ?? null,
      typeDesc: b.benefit_type_desc ?? null,
      head: b.benefit_head_code ?? null,
      headDesc: b.benefit_head_desc ?? null,
    })),
    annualLimit: limit.amt_yr ?? null,
    perVisitLimit: limit.amt_vis ?? null,
    lifetimeLimit: limit.amt_life ?? null,
    note: LIMIT_NOTE,
  }));
}

module.exports = { summarizeBenefitLimits };
