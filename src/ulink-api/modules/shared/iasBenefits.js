/**
 * Extracted from ias-claim-preparation/benefitPicker.js (2026-09-14) — member-verification's
 * benefit-eligibility check (SOP §6.4) needs the exact same flattening of a member's plan
 * benefits as the claim-submission benefit picker already does, so this moved here instead
 * of being duplicated. No behavior change from the original.
 */

/**
 * Flattens memberPlans[0].coverageLimits[].benefits[] (the member's own plan — already
 * stored raw on Case.iasMemberInfoResponse) into unique {type, typeDesc, head, headDesc}
 * combos — the same benefit can appear under multiple coverageLimits rows (per-limit-type
 * groupings), so this is deliberately deduped before any caller uses it.
 */
function uniqueBenefitCandidates(memberPlansRaw) {
  const plan = memberPlansRaw?.[0];
  const coverageLimits = plan?.coverageLimits || [];
  const seen = new Map();

  for (const limit of coverageLimits) {
    for (const benefit of limit.benefits || []) {
      if (!benefit.benefit_type_code) continue;
      const key = `${benefit.benefit_type_code}|${benefit.benefit_head_code || ''}`;
      if (!seen.has(key)) {
        seen.set(key, {
          type: benefit.benefit_type_code,
          typeDesc: benefit.benefit_type_desc,
          head: benefit.benefit_head_code,
          headDesc: benefit.benefit_head_desc,
        });
      }
    }
  }
  return [...seen.values()];
}

module.exports = { uniqueBenefitCandidates };
