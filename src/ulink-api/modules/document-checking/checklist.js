/**
 * Canonical customer-facing issue wording + the evaluator logic that decides which apply
 * to a case's extracted_fields. Most entries match the real missing-document email
 * template verbatim; three do not — see their own comments for why (no canned wording
 * exists for them yet). Pure code, deliberately not config-driven — each check has
 * genuinely distinct comparison logic (boolean read, numeric compare, OR-across-fields,
 * null-handling), not a repeatable shape a generic rules engine would pay for itself on.
 *
 * INCORRECT_BANK_DETAILS is intentionally NOT evaluated by anything in this file — that
 * specifically means "doesn't match what's on file at IAS," which needs
 * modules/member-verification/checks.js (its BANK_DETAILS_MISMATCH reasonCode). Its
 * canonical wording lives here (one source of truth for customer-facing wording), but is
 * looked up and used by modules/member-verification/service.js, not EVALUATORS below.
 * MEMBER_NOT_VERIFIED and POLICY_NOT_ACTIVE_ON_TREATMENT_DATE are the same story for
 * member-verification's other two reasonCodes (MEMBER_NOT_FOUND, COVERAGE_NOT_ACTIVE) —
 * with the added caveat that unlike every other entry here, these two are NOT from the
 * approved canned-response doc (no such line exists there yet) — placeholder wording,
 * flag for business sign-off before relying on the exact phrasing. Everything else here is
 * checkable from Case.extractedFields alone.
 *
 * Of extractedFields.identity_consistency.*, only bank_account_holder_consistent
 * (delegation letter) is currently evaluated — patient_name_consistent and
 * medical_record_provider_consistent are computed upstream by claim-recognition
 * (script-crossing name/place comparisons an LLM can judge but code-level string matching
 * structurally can't) but not trusted by this checklist at the moment; see the block
 * comment above EVALUATORS. invoice_provider_consistent no longer exists at all — its only
 * data source (invoices.items[].hospital_or_clinic_name) was removed as a fabrication risk
 * (see the schema migration that simplified invoices.items).
 */

const ISSUES = {
  INCOMPLETE_CLAIM_FORM: 'Incomplete medical claims form (Fill mention your diagnosis in section B)',
  INCORRECT_PATIENT_DETAILS: 'Incorrect patient details',
  MISSING_VOUCHER: 'Missing voucher(s)',
  NO_MEDICAL_REPORT: 'No Medical Report(s)',
  UNCLEAR_VOUCHER: 'Unclear voucher(s)',
  INCORRECT_VOUCHER: 'Incorrect voucher(s)',
  MISSING_VOUCHER_BREAKDOWN: 'Missing detailed breakdown for pharmacy charges in the voucher(s)',
  VOUCHER_AMOUNT_MISMATCH: 'The amount in the voucher(s) is not consistent with the claimed amount',
  INCORRECT_MEDICAL_REPORT: 'Incorrect medical report(s)',
  INCOMPLETE_MEDICAL_REPORT: 'Incomplete medical report(s)',
  MISSING_BANK_INFO: 'Missing bank information',
  INCORRECT_BANK_DETAILS: 'Incorrect bank details',
  DELEGATION_LETTER_REQUIRED: 'Please fill in the attached delegation letter to proceed with the payment process',
  MEMBER_NOT_VERIFIED:
    'We could not verify your membership/policy details in our system. Please double check your NRC/passport number and policy number and resubmit.',
  POLICY_NOT_ACTIVE_ON_TREATMENT_DATE:
    'Your policy does not appear to have been active on the date of treatment. Please contact us to verify your coverage period.',
};

function checkIncompleteClaimForm(fields) {
  const hasDiagnosis = fields.medical.detail_of_illness_injury || fields.medical.full_description_of_treatment;
  return hasDiagnosis ? null : ISSUES.INCOMPLETE_CLAIM_FORM;
}

// `?.`/`|| []` throughout, not plain property reads: extractedFields on a case processed
// before invoices became an array (or before identity_consistency existed at all) won't
// have these fields in the current shape — treat that the same as any other "can't
// determine" null, don't crash the whole run.

function checkMissingVoucher(fields) {
  return fields.invoices?.present === false ? ISSUES.MISSING_VOUCHER : null;
}

function checkNoMedicalReport(fields) {
  return fields.medical_record.present === false ? ISSUES.NO_MEDICAL_REPORT : null;
}

function checkUnclearVoucher(fields) {
  if (fields.invoices?.present !== true) return null; // covered by MISSING_VOUCHER instead
  const anyUnclear = (fields.invoices.items || []).some((item) => item.legible === false);
  return anyUnclear ? ISSUES.UNCLEAR_VOUCHER : null;
}

function checkIncompleteMedicalReport(fields) {
  if (fields.medical_record.present !== true) return null; // covered by NO_MEDICAL_REPORT instead
  return fields.medical_record.legible === false ? ISSUES.INCOMPLETE_MEDICAL_REPORT : null;
}

function checkMissingVoucherBreakdown(fields) {
  if (fields.invoices?.present !== true) return null;
  const anyMissingBreakdown = (fields.invoices.items || []).some((item) => item.has_itemized_breakdown === false);
  return anyMissingBreakdown ? ISSUES.MISSING_VOUCHER_BREAKDOWN : null;
}

/**
 * Sums every voucher's own subtotal before comparing to the form's claimed amount — a
 * case can have more than one voucher (e.g. a hospital receipt + a separate pharmacy
 * receipt), and the claimed total is meant to match their combined subtotal, not any
 * single one of them (verified against real data: 45,000 + 9,690 = 54,690).
 */
function checkVoucherAmountMismatch(fields) {
  if (fields.invoices?.present !== true) return null;
  const subtotals = (fields.invoices.items || []).map((item) => item.subtotal).filter((amount) => amount != null);
  if (subtotals.length === 0) return null; // no readable amount on any voucher — nothing to compare
  const voucherTotal = subtotals.reduce((sum, amount) => sum + amount, 0);
  const claimedAmount = fields.claim.total_claim_amount;
  if (claimedAmount == null) return null;
  return voucherTotal !== claimedAmount ? ISSUES.VOUCHER_AMOUNT_MISMATCH : null;
}

// Disabled (not in EVALUATORS) — see the block comment above EVALUATORS. Kept defined so
// re-enabling later is a one-line change, not a rewrite.
function checkIncorrectPatientDetails(fields) {
  return fields.identity_consistency?.patient_name_consistent === false ? ISSUES.INCORRECT_PATIENT_DETAILS : null;
}

// Deliberately does NOT read identity_consistency.invoice_provider_consistent — verified
// unreliable against real data (complete/1: came back false with nothing on either side to
// compare) on top of being a compounding-error-prone LLM judgment layered on top of
// extraction that's itself sometimes wrong (see synthesize.md's invoices-fabrication
// guidance). Deadline-driven call: not worth chasing further right now, so this check is
// scoped down to just the one signal that's held up — the clinic/doctor authentication
// mark (has_clinic_stamp_or_doctor_signature, verified against incomplete/jd1/1, Shin Minn
// Thi, where a handwritten voucher carrying only a generic pharmacy dispensing stamp was
// rejected under this same reason by the human reviewer).
function checkIncorrectVoucher(fields) {
  if (fields.invoices?.present !== true) return null;
  const anyMissingStamp = (fields.invoices.items || []).some((item) => item.has_clinic_stamp_or_doctor_signature === false);
  return anyMissingStamp ? ISSUES.INCORRECT_VOUCHER : null;
}

// Disabled (not in EVALUATORS) — see the block comment above EVALUATORS.
function checkIncorrectMedicalReport(fields) {
  if (fields.medical_record.present !== true) return null;
  return fields.identity_consistency?.medical_record_provider_consistent === false
    ? ISSUES.INCORRECT_MEDICAL_REPORT
    : null;
}

function checkMissingBankInfo(fields) {
  const bank = fields.bank;
  const allMissing = !bank.bank_name && !bank.bank_account_name && !bank.bank_account_number;
  return allMissing ? ISSUES.MISSING_BANK_INFO : null;
}

// Confirmed JD2-scope rule (delegation letter required when the payment recipient differs
// from the claimant — docs/samples/20260820/20260821 ULINK STP Confirmed Assumptions and
// Implementation Advice.md), pulled forward into this checklist as a plain detection flag.
// Not in the canned-response template (no fixed wording exists yet for it) — verified
// against real sample data (incomplete/jd2, Khin Maung) where the human reviewer sent this
// exact request as free text. This is a different concept from "Incorrect bank details"
// above: the bank details here are valid, just for someone other than the claimant.
function checkDelegationLetterRequired(fields) {
  return fields.identity_consistency?.bank_account_holder_consistent === false ? ISSUES.DELEGATION_LETTER_REQUIRED : null;
}

// identity_consistency.patient_name_consistent and .medical_record_provider_consistent are
// deliberately not evaluated right now — checkIncorrectPatientDetails and
// checkIncorrectMedicalReport are defined above but left out of this list. Deadline-driven
// call (2026-08-22): this LLM-judged comparison layer, on top of extraction that's itself
// sometimes unreliable on messy/handwritten documents, produced enough false positives on
// known-complete samples (complete/1, complete/2) that it's not worth the remaining time to
// harden before ship. .invoice_provider_consistent was dropped the same way (see
// checkIncorrectVoucher). Scope was deliberately kept to two identity_consistency-backed
// checks — stamp/authentication (checkIncorrectVoucher's has_clinic_stamp_or_doctor_signature
// path) and delegation letter (checkDelegationLetterRequired, below) — both verified
// reliable against real sample data, unlike the other two. Re-enable the rest by adding
// checkIncorrectPatientDetails/checkIncorrectMedicalReport back to EVALUATORS once there's
// time to revisit reliability (see the two-pass extraction/consistency-judgment split
// discussed for that work).
const EVALUATORS = [
  checkIncompleteClaimForm,
  checkMissingVoucher,
  checkNoMedicalReport,
  checkUnclearVoucher,
  checkIncorrectVoucher,
  checkMissingVoucherBreakdown,
  checkVoucherAmountMismatch,
  checkIncompleteMedicalReport,
  checkMissingBankInfo,
  checkDelegationLetterRequired,
];

function evaluateDocumentChecks(extractedFields) {
  const issues = EVALUATORS.map((evaluate) => evaluate(extractedFields)).filter(Boolean);
  return { issues, passed: issues.length === 0 };
}

module.exports = { ISSUES, evaluateDocumentChecks };
