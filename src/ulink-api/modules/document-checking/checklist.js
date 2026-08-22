/**
 * Canonical customer-facing issue wording (matches the real missing-document email
 * template verbatim) + the evaluator logic that decides which apply to a case's
 * extracted_fields. Pure code, deliberately not config-driven — each check has
 * genuinely distinct comparison logic (boolean read, numeric compare, OR-across-fields,
 * null-handling), not a repeatable shape a generic rules engine would pay for itself on.
 *
 * "Incorrect bank details" is intentionally NOT evaluated here — that specifically means
 * "doesn't match what's on file at IAS," which needs the member-verification block
 * (not built yet). Everything else is checkable from Case.extractedFields alone.
 *
 * The 3 identity-matching checks (patient/provider names) read pre-computed
 * extractedFields.identity_consistency.* rather than comparing strings here — those
 * comparisons can legitimately cross scripts (Burmese on a form vs Latin on a scanned
 * document), which is not something code-level string matching can judge at all, only
 * an LLM that already read both documents can. See claim-recognition's synthesize.md.
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
};

function checkIncompleteClaimForm(fields) {
  const hasDiagnosis = fields.medical.detail_of_illness_injury || fields.medical.full_description_of_treatment;
  return hasDiagnosis ? null : ISSUES.INCOMPLETE_CLAIM_FORM;
}

function checkMissingVoucher(fields) {
  return fields.invoice.present === false ? ISSUES.MISSING_VOUCHER : null;
}

function checkNoMedicalReport(fields) {
  return fields.medical_record.present === false ? ISSUES.NO_MEDICAL_REPORT : null;
}

function checkUnclearVoucher(fields) {
  if (fields.invoice.present !== true) return null; // covered by MISSING_VOUCHER instead
  return fields.invoice.legible === false ? ISSUES.UNCLEAR_VOUCHER : null;
}

function checkIncompleteMedicalReport(fields) {
  if (fields.medical_record.present !== true) return null; // covered by NO_MEDICAL_REPORT instead
  return fields.medical_record.legible === false ? ISSUES.INCOMPLETE_MEDICAL_REPORT : null;
}

function checkMissingVoucherBreakdown(fields) {
  if (fields.invoice.present !== true) return null;
  return fields.invoice.has_itemized_breakdown === false ? ISSUES.MISSING_VOUCHER_BREAKDOWN : null;
}

function checkVoucherAmountMismatch(fields) {
  const voucherAmount = fields.invoice.invoice_amount;
  const claimedAmount = fields.claim.total_claim_amount;
  if (voucherAmount == null || claimedAmount == null) return null;
  return voucherAmount !== claimedAmount ? ISSUES.VOUCHER_AMOUNT_MISMATCH : null;
}

function checkIncorrectPatientDetails(fields) {
  return fields.identity_consistency.patient_name_consistent === false ? ISSUES.INCORRECT_PATIENT_DETAILS : null;
}

function checkIncorrectVoucher(fields) {
  if (fields.invoice.present !== true) return null;
  return fields.identity_consistency.invoice_provider_consistent === false ? ISSUES.INCORRECT_VOUCHER : null;
}

function checkIncorrectMedicalReport(fields) {
  if (fields.medical_record.present !== true) return null;
  return fields.identity_consistency.medical_record_provider_consistent === false
    ? ISSUES.INCORRECT_MEDICAL_REPORT
    : null;
}

function checkMissingBankInfo(fields) {
  const bank = fields.bank;
  const allMissing = !bank.bank_name && !bank.bank_account_name && !bank.bank_account_number;
  return allMissing ? ISSUES.MISSING_BANK_INFO : null;
}

const EVALUATORS = [
  checkIncompleteClaimForm,
  checkIncorrectPatientDetails,
  checkMissingVoucher,
  checkNoMedicalReport,
  checkUnclearVoucher,
  checkIncorrectVoucher,
  checkMissingVoucherBreakdown,
  checkVoucherAmountMismatch,
  checkIncorrectMedicalReport,
  checkIncompleteMedicalReport,
  checkMissingBankInfo,
];

function evaluateDocumentChecks(extractedFields) {
  const issues = EVALUATORS.map((evaluate) => evaluate(extractedFields)).filter(Boolean);
  return { issues, passed: issues.length === 0 };
}

module.exports = { ISSUES, evaluateDocumentChecks };
