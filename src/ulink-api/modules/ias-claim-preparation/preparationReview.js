// Claim preparation stops for a person (API_PREPARATION_REVIEW, owner 2026-10-20) when the AI wasn't sure of the
// diagnosis code, of a voucher's benefit, or of a voucher's vitamins / supplements (its manual rejection) — before
// anything goes to IAS. One rule for the job that stops the case
// (api-claim-preparation), the save that lets it go on (preparationController) and the case page. Pure.

const unsure = (confidence, threshold) => typeof confidence === 'number' && confidence <= threshold;

// The default code (R69), or the pick at or below the threshold. A code a person chose is decided, and so is a code a
// ULINK rule set from the benefit (diagnosisRules.js, rule.set).
function diagnosisUnsure(diagnosis, threshold) {
  if (!diagnosis || diagnosis.chosen || diagnosis.rule?.set) return false;
  return Boolean(diagnosis.defaulted) || unsure(diagnosis.confidence, threshold);
}

// No benefit, no head where the member's plan has heads for that type, or the pick at or below the threshold.
function benefitUnsure(line, threshold) {
  if (!line || line.chosen) return false;
  if (!line.pick?.benefitType) return true;
  const typeHasHeads = (line.candidates || []).some((c) => c.type === line.pick.benefitType && c.head);
  if (!line.pick.benefitHead && typeHasHeads) return true;
  return unsure(line.confidence, threshold);
}

// A voucher's vitamins / supplements (line.vitamin, ias-claim-preparation): the AI couldn't tell, said "none" unsure, or
// found some but was unsure, read no amount or an amount above the voucher, or named no item. A person's is decided.
function rejectionUnsure(vitamin, threshold) {
  if (!vitamin || vitamin.chosen) return false;
  if (vitamin.found === null) return true;
  if (unsure(vitamin.confidence, threshold)) return true;
  return vitamin.found === true && (vitamin.ai?.vitamin_exclude_amount == null || !vitamin.ai?.vitamin_remark);
}

/**
 * What a person has to decide on this preparation, by the switches on: { diagnosis: bool, vouchers: [index…],
 * rejections: [index…] } (vouchers: the benefit; rejections: the manual rejection for vitamins / supplements) — or
 * null when nothing (the case goes on). claimPrepMeta: ias-claim-preparation's { diagnosis, lines }.
 */
function reviewNeeded(claimPrepMeta, { holdUnsureDiagnosis, holdUnsureBenefit, holdUnsureVitamin, aiConfidenceThreshold }) {
  const diagnosis = Boolean(holdUnsureDiagnosis) && diagnosisUnsure(claimPrepMeta?.diagnosis, aiConfidenceThreshold);
  const vouchers = holdUnsureBenefit
    ? (claimPrepMeta?.lines || []).map((line, i) => (benefitUnsure(line, aiConfidenceThreshold) ? i : null)).filter((i) => i !== null)
    : [];
  const rejections = holdUnsureVitamin
    ? (claimPrepMeta?.lines || []).map((line, i) => (rejectionUnsure(line.vitamin, aiConfidenceThreshold) ? i : null)).filter((i) => i !== null)
    : [];
  return diagnosis || vouchers.length || rejections.length ? { diagnosis, vouchers, rejections } : null;
}

// What identifies a voucher for a person's benefit choice: a re-read that changes it drops the choice.
const voucherKey = (item) => ({ subtotal: item?.subtotal ?? null, date: item?.date ?? null, voucherType: item?.voucher_type ?? null });
const sameVoucher = (a, b) => a.subtotal === b.subtotal && a.date === b.date && a.voucherType === b.voucherType;

// What identifies the diagnosis for a person's code: the claim form's own text (source), before the AI translates it —
// the translation's wording changes from run to run. A choice saved before source was kept: the English text.
const diagnosisSource = (medical) => `${medical?.detail_of_illness_injury || ''}\n${medical?.full_description_of_treatment || ''}`;
const sameDiagnosis = (choice, now) => (choice?.source != null ? choice.source === now.source : choice?.text === now.text);

module.exports = { diagnosisUnsure, benefitUnsure, rejectionUnsure, reviewNeeded, voucherKey, sameVoucher, diagnosisSource, sameDiagnosis };
