// The member's remaining balance per voucher (SYSTEM_5 member balance, docs/imp/CR/SYSTEM_5/PRD/MEMBER_BALANCE_PRD.md
// section 4.4). Pure: takes the IAS answers as data (iasClient.js fetches them). Owner rules, 2026-10-26:
// - the balance entry is the results[] item with the member plan's plan_id and rev_no
// - every limit that covers a voucher counts: Benefit Head (H), Benefit Type (T), Combine Head (CH), Combine Type (CT)
// - the amounts are the remaining balance; null = no limit (skipped); 0 = used up
// - the claim being checked is not in the balance, so each voucher is compared with what is left

// Remaining balances: vouchers that share a limit are added up against it.
const BALANCE_FIELDS = { amt_yr: null, amt_dis_yr: 'year per disability', amt_life: 'lifetime', amt_dis_life: 'lifetime per disability', amt_pocy: 'policy period' };
// A limit for one visit: each voucher on its own.
const VISIT_FIELDS = { amt_vis: 'per visit' };
// Not compared (Q3a): amt_day, amt_sur, chronic_ongoing_amt*, deduct_amt*, copay_amt_yr.
const COMPARED_FIELDS = [...Object.keys(BALANCE_FIELDS), ...Object.keys(VISIT_FIELDS)];

// IAS codes and ids compared as written apart from case, spaces and leading zeros ("01" and 1 are one revision).
const code = (value) => (value == null ? null : String(value).trim().toUpperCase());
const id = (value) => (value == null ? null : String(value).trim().replace(/^0+(?=\d)/, ''));

const { coveringPolicy } = require('./exclusions');

const amount = (n) => Number(n).toLocaleString('en-US');

// The three request values, from the member info answer (getMemberInfo). Null when one is missing.
// treatmentDate (YYYY-MM-DD): the policy period that holds it is asked about, as for the exclusions (coveringPolicy).
function balanceRequest(iasMemberInfoResponse, treatmentDate = null) {
  const payload = iasMemberInfoResponse?.payload;
  const policy = coveringPolicy(iasMemberInfoResponse, treatmentDate);
  const request = {
    memberRefNo: payload?.member?.MBR_REF_NO ?? null,
    policyRefNo: policy?.POCY_REF_NO ?? null,
    policyEffDate: policy?.EFF_DATE ?? null,
  };
  return Object.values(request).every(Boolean) ? request : null;
}

// The member plan the balance entry must match (memberPlans[0].plan).
function memberPlanKey(iasMemberInfoResponse) {
  const plan = iasMemberInfoResponse?.payload?.memberPlans?.[0]?.plan;
  return plan?.PLAN_ID ? { planId: String(plan.PLAN_ID).trim(), revNo: plan.REV_NO == null ? null : String(plan.REV_NO).trim() } : null;
}

// A limit covers a voucher when one of its benefits is the voucher's type, with no head (a type limit) or the voucher's
// head. A voucher with no head is covered only by the type limits (T and CT carry no head).
function covers(limit, voucher) {
  return (limit.benefits || []).some((b) => code(b.benefit_type_code) === code(voucher.benefitType)
    && (b.benefit_head_code == null || (voucher.benefitHead != null && code(b.benefit_head_code) === code(voucher.benefitHead))));
}

// What the balance line shows for one limit (owner, 2026-11-16): "Head Level - VACC", "Type Level - OP",
// "Combine Head Level", "Combine Type Level", with the kind of amount when it is not the yearly one ("per visit").
const LEVELS = { H: 'Head Level', T: 'Type Level', CH: 'Combine Head Level', CT: 'Combine Type Level' };
const LEVEL_ORDER = Object.keys(LEVELS);
function limitLevel(limit, voucher, field) {
  const type = limit.limit_type_code;
  const level = type === 'H' ? `${LEVELS.H} - ${voucher.benefitHead}` : type === 'T' ? `${LEVELS.T} - ${voucher.benefitType}` : LEVELS[type] ?? type;
  const kind = BALANCE_FIELDS[field] ?? VISIT_FIELDS[field] ?? null;
  return kind ? `${level} ${kind}` : level;
}
const levelRank = (limit) => (LEVEL_ORDER.includes(limit.limit_type_code) ? LEVEL_ORDER.indexOf(limit.limit_type_code) : LEVEL_ORDER.length);

function limitLabel(limit, voucher, field) {
  const code = limit.limit_type_code === 'H' ? voucher.benefitHead : limit.limit_type_code === 'T' ? voucher.benefitType : 'combined';
  const kind = BALANCE_FIELDS[field] ?? VISIT_FIELDS[field] ?? null;
  return `${limit.limit_type_code} ${code}${kind ? `, ${kind}` : ''}`;
}

// The descriptions IAS gives for the voucher's type and head (from any limit that names them).
function descriptions(limits, voucher) {
  const benefits = limits.flatMap((l) => l.benefits || []);
  const type = benefits.find((b) => code(b.benefit_type_code) === code(voucher.benefitType))?.benefit_type_desc ?? null;
  const head = voucher.benefitHead == null ? null
    : benefits.find((b) => code(b.benefit_type_code) === code(voucher.benefitType) && code(b.benefit_head_code) === code(voucher.benefitHead))?.benefit_head_desc ?? null;
  return { benefitTypeDesc: type, benefitHeadDesc: head };
}

/**
 * vouchers: [{ voucher (1-based number), amount, benefitType, benefitHead (null when not known) }], in the order the AI
 * read them. Returns { planFound, lines, short }: one line per voucher with the lowest balance left among the limits that
 * cover it, the limit that gave it, and enough (true / false; null when the voucher has no amount or no type). short:
 * the lines that are not enough — the member:balance finding.
 */
function checkBalance(balanceResponse, planKey, vouchers) {
  const plan = planKey && (balanceResponse?.payload?.results || [])
    .find((r) => id(r.plan_id) === id(planKey.planId) && id(r.rev_no) === id(planKey.revNo));
  if (!plan) return { planFound: false, lines: [], short: [] };

  const limits = plan.limits || [];
  const used = new Map(); // `${limit index}:${field}` → amount of the vouchers before
  const lines = vouchers.map((voucher) => {
    const base = { ...voucher, ...descriptions(limits, voucher) };
    // An amount that is not a number (none read) is not checked — never a false shortage, never NaN on a shared limit.
    // A refund / cash-return slip (0 or below, as document-checking treats it) is not checked either: it would lower a
    // shared limit's total and hide a real shortage.
    if (voucher.amount == null || !Number.isFinite(Number(voucher.amount)) || Number(voucher.amount) <= 0 || !voucher.benefitType) {
      return { ...base, balanceLeft: null, limit: null, earlier: false, enough: null };
    }

    const covering = limits.map((limit, index) => ({ limit, index })).filter(({ limit }) => covers(limit, voucher));
    let lowest = null;
    const balances = []; // every covering limit's balance, H, T, CH, CT: the line shows them all
    for (const { limit, index } of covering) {
      for (const field of COMPARED_FIELDS) {
        if (limit[field] == null) continue;
        const before = field in BALANCE_FIELDS ? used.get(`${index}:${field}`) || 0 : 0;
        const left = Number(limit[field]) - before;
        if (!lowest || left < lowest.left) lowest = { left, label: limitLabel(limit, voucher, field), earlier: before > 0 };
        balances.push({ limit, level: limitLevel(limit, voucher, field), left, earlier: before > 0, enough: left >= Number(voucher.amount) });
      }
    }
    balances.sort((a, b) => levelRank(a.limit) - levelRank(b.limit));
    for (const { index, limit } of covering) {
      for (const field of Object.keys(BALANCE_FIELDS)) {
        if (limit[field] != null) used.set(`${index}:${field}`, (used.get(`${index}:${field}`) || 0) + Number(voucher.amount));
      }
    }
    return lowest
      ? { ...base, balanceLeft: lowest.left, limit: lowest.label, earlier: lowest.earlier, enough: lowest.left >= Number(voucher.amount), balances: balances.map((b) => ({ level: b.level, left: b.left, earlier: b.earlier, enough: b.enough })) }
      : { ...base, balanceLeft: null, limit: null, earlier: false, enough: true }; // no limit covers it
  });
  return { planFound: true, lines, short: lines.filter((l) => l.enough === false) };
}

// "Voucher 2 (OP Outpatient / RX Prescribed Medicine): voucher 100,000, not enough. Balance: Head Level - RX 50,000 left
// (not enough); Type Level - OP 1,540,000; Combine Type Level 44,000,000" — every covering limit, one per "; " (the
// console shows each on its own line). "left": earlier vouchers of the claim share that limit.
function balanceLineText(line) {
  const type = [line.benefitType, line.benefitTypeDesc].filter(Boolean).join(' ');
  const head = line.benefitHead == null ? null : [line.benefitHead, line.benefitHeadDesc].filter(Boolean).join(' ');
  // voucher null: the claim total, checked while the case has no voucher yet.
  const what = `${line.voucher == null ? 'Claim total' : `Voucher ${line.voucher}`} (${[type || 'benefit not known', head].filter(Boolean).join(' / ')})`;
  const claimed = `${line.voucher == null ? 'claimed' : 'voucher'} ${amount(line.amount)}`;
  if (line.enough == null) return `${what}: ${line.amount == null || !Number.isFinite(Number(line.amount)) ? 'no amount read' : claimed}, balance not checked`;
  if (line.balanceLeft == null) return `${what}: ${claimed}, no limit, enough`;
  const balances = (line.balances || []).map((b) => `${b.level} ${amount(b.left)}${b.earlier ? ' left' : ''}${b.enough ? '' : ' (not enough)'}`);
  return `${what}: ${claimed}, ${line.enough ? 'enough' : 'not enough'}. Balance: ${balances.join('; ')}`;
}

module.exports = { balanceRequest, memberPlanKey, checkBalance, balanceLineText };
