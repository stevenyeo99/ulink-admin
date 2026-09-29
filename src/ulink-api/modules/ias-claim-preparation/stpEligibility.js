const { StpRule, StpBlockedDiagnosis } = require('../../db/models');

const amount = (n) => Number(n).toLocaleString('en-US');

/**
 * STP (straight-through processing) decision from the rules set on the console Settings page
 * (ulink_stp_rules + ulink_stp_blocked_diagnoses). Pure — rules are passed in.
 *
 * A case is STP only when nothing below blocks it; every block is kept as a reason:
 * - a line has no IAS benefit type (the AI couldn't pick one) — no rule can apply;
 * - no rule for the case type + benefit type + currency, or the rule says STP not allowed;
 * - the case's lines of one benefit type add up to more than that type's limit;
 * - the diagnosis code starts with a blocked prefix (R69 = diagnosis not found).
 *
 * Returns { isStp, source, currency, diagCode, benefits: [{ benefitType, total, allowed, limit }], reasons }.
 */
function evaluateStp({ rules, blockedDiagnoses }, { source, currency, lines, diagCode }) {
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

  return { isStp: reasons.length === 0, source, currency, diagCode: diagCode ?? null, benefits, reasons };
}

async function stpDecision(input) {
  const [rules, blockedDiagnoses] = await Promise.all([StpRule.findAll(), StpBlockedDiagnosis.findAll()]);
  return evaluateStp({ rules, blockedDiagnoses }, input);
}

module.exports = { stpDecision, evaluateStp };
