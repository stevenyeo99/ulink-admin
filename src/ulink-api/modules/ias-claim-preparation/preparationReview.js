// Claim preparation stops for a person (API_PREPARATION_REVIEW, owner 2026-10-20) when the AI wasn't sure of the
// diagnosis code or of a voucher's benefit — before anything goes to IAS. One rule for the job that stops the case
// (api-claim-preparation), the save that lets it go on (preparationController) and the case page. Pure.

const unsure = (confidence, threshold) => typeof confidence === 'number' && confidence <= threshold;

// The default code (R69), or the pick at or below the threshold. A code a person chose is decided.
function diagnosisUnsure(diagnosis, threshold) {
  if (!diagnosis || diagnosis.chosen) return false;
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

/**
 * What a person has to decide on this preparation, by the switches on: { diagnosis: bool, vouchers: [index…] } — or
 * null when nothing (the case goes on). claimPrepMeta: ias-claim-preparation's { diagnosis, lines }.
 */
function reviewNeeded(claimPrepMeta, { holdUnsureDiagnosis, holdUnsureBenefit, aiConfidenceThreshold }) {
  const diagnosis = Boolean(holdUnsureDiagnosis) && diagnosisUnsure(claimPrepMeta?.diagnosis, aiConfidenceThreshold);
  const vouchers = holdUnsureBenefit
    ? (claimPrepMeta?.lines || []).map((line, i) => (benefitUnsure(line, aiConfidenceThreshold) ? i : null)).filter((i) => i !== null)
    : [];
  return diagnosis || vouchers.length ? { diagnosis, vouchers } : null;
}

// What identifies a voucher for a person's benefit choice: a re-read that changes it drops the choice.
const voucherKey = (item) => ({ subtotal: item?.subtotal ?? null, date: item?.date ?? null, voucherType: item?.voucher_type ?? null });
const sameVoucher = (a, b) => a.subtotal === b.subtotal && a.date === b.date && a.voucherType === b.voucherType;

module.exports = { diagnosisUnsure, benefitUnsure, reviewNeeded, voucherKey, sameVoucher };
