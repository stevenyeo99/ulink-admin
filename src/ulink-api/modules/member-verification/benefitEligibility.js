/**
 * SOP §6.4 (Treatment Type vs Eligible Benefit) — pure, deterministic, no LLM: is the
 * claimed benefit type among the member's own plan's covered benefit types at all? Coarser
 * than ias-claim-preparation/benefitPicker.js's exact-head pick (which needs an LLM to
 * choose the right head per voucher) — this only needs set membership, so it doesn't need
 * one. Same shared candidate list, modules/shared/iasBenefits.js, no duplicated flattening.
 *
 * SOP: JD1 never rejects on this, only flags it for the approver (JD3) — same non-blocking
 * contract as exclusionFlags.js's POSSIBLE_EXCLUSION, so this returns a flag object (or
 * null), not an outcome/reasonCode.
 */
const { uniqueBenefitCandidates } = require('../shared/iasBenefits');

function norm(value) {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

// The claim form's own words for a type IAS names differently (case AYA-CL-26043772: "dental care" vs IAS "Dental").
const PATIENT_TYPE_ALIASES = { 'dental care': 'dental', 'optical care': 'vision' };

/**
 * Only `type_of_patient` (Outpatient/Inpatient) is comparable to IAS's benefit-type
 * candidates — `claim.claim_benefit_type` is the claim's payment MECHANISM (Reimbursement/
 * Cashless), a different concept entirely; every real fixture in this codebase has it as
 * "Reimbursement" regardless of treatment type, confirmed while building this check's own
 * fixtures. Comparing that field against benefit-type candidates would false-flag every
 * reimbursement claim, so it's deliberately not used here.
 *
 * Returns null when there's nothing to check (no candidates on the plan, or the claim
 * itself has no type_of_patient) or when a match is found — a flag object only when
 * type_of_patient matches none of the member's own candidates.
 */
// The member's benefit candidate that the claim form's type of patient names, or null (none named, or no match).
function patientTypeCandidate(extractedFields, candidates) {
  const written = norm(extractedFields.claim?.type_of_patient);
  if (!written) return null;
  const typeOfPatient = PATIENT_TYPE_ALIASES[written] || written;
  return candidates.find((c) => typeOfPatient === norm(c.type) || typeOfPatient === norm(c.typeDesc)) || null;
}

// The IAS benefit type code (e.g. "OP") the claim form's type of patient names — the member balance check uses it for a
// voucher with no head (member-verification/memberBalance.js). Null when it names none of the member's types.
function claimBenefitType(extractedFields, memberPlansRaw) {
  return patientTypeCandidate(extractedFields, uniqueBenefitCandidates(memberPlansRaw))?.type ?? null;
}

function checkBenefitEligibility(extractedFields, memberPlansRaw) {
  const candidates = uniqueBenefitCandidates(memberPlansRaw);
  if (candidates.length === 0) return null;
  if (!norm(extractedFields.claim?.type_of_patient)) return null;
  if (patientTypeCandidate(extractedFields, candidates)) return null;

  return {
    code: 'BENEFIT_NOT_ELIGIBLE',
    desc: "The claimed treatment type does not appear among the member's covered benefit types on file.",
    reason: `Type of patient "${extractedFields.claim?.type_of_patient}" matched none of the member's covered benefit types: ${candidates.map((c) => c.typeDesc || c.type).join(', ')}.`,
  };
}

module.exports = { checkBenefitEligibility, claimBenefitType };
