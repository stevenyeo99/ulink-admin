const { StpRule, StpBlockedDiagnosis } = require('../../db/models');
const { getSettings } = require('../settings/settings');

const amount = (n) => Number(n).toLocaleString('en-US');

/**
 * STP (straight-through processing) decision from the rules set on the console Settings page
 * (ulink_stp_rules + ulink_stp_blocked_diagnoses). Pure — rules are passed in.
 *
 * A case is STP only when nothing below blocks it; every block is kept as a reason:
 * - a line has no IAS benefit type (the AI couldn't pick one) — no rule can apply;
 * - no rule for the case type + benefit type + currency, or the rule says STP not allowed;
 * - the case's lines of one benefit type add up to more than that type's limit;
 * - the diagnosis code starts with a blocked prefix (R69 = diagnosis not found);
 * - switch "open review point blocks STP" on (settings) and the case has an open review point — the
 *   AI was unsure, a possible exclusion, … (openReviewPoints: [{ decision, reason }]) — a person checks first.
 *
 * Returns { isStp, source, currency, diagCode, benefits: [{ benefitType, total, allowed, limit }], reasons }.
 */
function evaluateStp({ rules, blockedDiagnoses, blockOnReviewPoints = false }, { source, currency, lines, diagCode, openReviewPoints = [] }) {
  const reasons = [];
  const totals = new Map();
  for (const { benefitType, subtotal } of lines) {
    if (!benefitType) {
      reasons.push('A voucher has no benefit type, so no STP rule applies.');
      continue;
    }
    totals.set(benefitType, (totals.get(benefitType) ?? 0) + (subtotal ?? 0));
  }
  if (lines.length === 0) reasons.push('The claim has no invoice lines.');

  const benefits = [...totals].map(([benefitType, total]) => {
    const rule = rules.find((r) => r.caseSource === source && r.benefitType === benefitType && r.currency === currency);
    const limit = rule?.amountLimit == null ? null : Number(rule.amountLimit);
    const allowed = Boolean(rule?.stpAllowed);
    if (!rule) reasons.push(`No STP rule for ${benefitType} in ${currency}.`);
    else if (!allowed) reasons.push(`${benefitType} is not allowed for STP.`);
    else if (limit == null || total > limit) {
      reasons.push(limit == null ? `${benefitType} has no amount limit set.` : `${benefitType} ${amount(total)} ${currency} > limit ${amount(limit)}.`);
    }
    return { benefitType, total, allowed, limit };
  });

  const blocked = diagCode && blockedDiagnoses.find((d) => diagCode.toUpperCase().startsWith(d.codePrefix.toUpperCase()));
  if (blocked) reasons.push(`Diagnosis ${diagCode} is on the never-STP list (${blocked.codePrefix}${blocked.note ? `: ${blocked.note}` : ''}).`);

  if (blockOnReviewPoints && openReviewPoints.length) {
    reasons.push(`Open review point${openReviewPoints.length > 1 ? 's' : ''}: ${openReviewPoints.map((p) => `${p.decision} (${p.reason})`).join('; ')} — a person checks first.`);
  }

  return { isStp: reasons.length === 0, source, currency, diagCode: diagCode ?? null, benefits, reasons };
}

async function stpDecision(input) {
  const [rules, blockedDiagnoses, settings] = await Promise.all([StpRule.findAll(), StpBlockedDiagnosis.findAll(), getSettings()]);
  return evaluateStp({ rules, blockedDiagnoses, blockOnReviewPoints: settings.stpBlockOnReviewPoints }, input);
}

module.exports = { stpDecision, evaluateStp };
