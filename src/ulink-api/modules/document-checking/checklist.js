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

function normalize(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return trimmed || null;
}

function stripTitle(value) {
  const normalized = normalize(value);
  if (!normalized) return null;
  return normalized.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/, '');
}

/**
 * Returns true/false when both sides have data to compare, null when either side is
 * unknown — a null here means "can't say," not "matches." A missing/unclear field is a
 * different problem, already covered by its own unclear/incomplete/missing check —
 * never let that same null also trigger an "incorrect" flag here.
 */
function namesMatch(a, b) {
  const left = stripTitle(a);
  const right = stripTitle(b);
  if (!left || !right) return null;
  return left === right;
}

function stringsMatch(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return null;
  return left === right;
}

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
  const claimantName = fields.claimant.claimant_name;
  const invoiceMismatch = namesMatch(claimantName, fields.invoice.patient_name) === false;
  const medicalRecordMismatch = namesMatch(claimantName, fields.medical_record.patient_name) === false;
  return invoiceMismatch || medicalRecordMismatch ? ISSUES.INCORRECT_PATIENT_DETAILS : null;
}

function checkIncorrectVoucher(fields) {
  if (fields.invoice.present !== true) return null;
  const mismatch = stringsMatch(fields.medical.hospital_or_clinic_name, fields.invoice.hospital_or_clinic_name) === false;
  return mismatch ? ISSUES.INCORRECT_VOUCHER : null;
}

function checkIncorrectMedicalReport(fields) {
  if (fields.medical_record.present !== true) return null;
  // Doctor names carry the same "Dr."/"Dr" title-formatting variance as patient names —
  // use namesMatch (title-stripping), not a plain string compare, or "Dr Aye Mrat Khine"
  // vs "Dr. Aye Mrat Khine" false-positives as a mismatch (verified against real data).
  const doctorMismatch = namesMatch(fields.medical.doctor_name, fields.medical_record.doctor_name) === false;
  const hospitalMismatch =
    stringsMatch(fields.medical.hospital_or_clinic_name, fields.medical_record.hospital_or_clinic_name) === false;
  return doctorMismatch || hospitalMismatch ? ISSUES.INCORRECT_MEDICAL_REPORT : null;
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
