const { todayInIasTimezone } = require('../shared/iasDates');
const { lastReadSettings } = require('../settings/settings');

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
  // ULINK staff's own wording (their reply to AYA-CL-26043392, 2026-10-19).
  EYE_TEST_SLIP_UNDATED: 'Need to fill treatment date in the eye test record',
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

// Eye test slips the AI found (document_list), each with its own confidence and reason (owner, 2026-10-19: the staff
// did not ask AYA-CL-26043392 for a medical report, only for a dated eye test slip). A slip the AI was unsure is an
// eye test slip (at or below the AI confidence threshold) does not stand in for the medical record.
const eyeTestSlips = (fields) => (fields.document_list || []).filter((d) => d.kind === 'eye_test_slip');
const trustedEyeTestSlips = (fields) => eyeTestSlips(fields).filter((d) => !isUnsure(d.confidence));
// No date written at all. A date the AI read in another form ("08/10/2026") is a date on the slip: not asked for.
const undatedEyeTestSlips = (fields) => eyeTestSlips(fields).filter((d) => d.date == null || d.date === '');

// A doctor's page the AI found in the page list stands in for the medical record too (owner, 2026-10-20: AYA-CL-26043772 /
// AYA-CL-26043766, dental — the AI's medical_record said "no record" while its own page list had the consultation pages).
// A medical book cover or a lab result alone is not one. A page the AI was unsure of does not count.
const DOCTOR_PAGE_KINDS = new Set(['consultation_note', 'dental_consultation', 'discharge_summary', 'operation_or_procedure_note']);
const trustedDoctorPages = (fields) => (fields.document_list || []).filter((d) => DOCTOR_PAGE_KINDS.has(d.kind) && !isUnsure(d.confidence));

function checkNoMedicalReport(fields) {
  return fields.medical_record.present === false && trustedEyeTestSlips(fields).length === 0 && trustedDoctorPages(fields).length === 0
    ? ISSUES.NO_MEDICAL_REPORT : null;
}

// An eye test slip without a date (owner, 2026-10-19): the customer is asked, in the staff's own wording.
function checkEyeTestSlipUndated(fields) {
  return undatedEyeTestSlips(fields).length ? ISSUES.EYE_TEST_SLIP_UNDATED : null;
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

// Scoped to voucher_type === 'pharmacy' only — the canonical wording (verified verbatim
// against docs/samples/20260820/Canned response for Sample.docx) specifically says
// "pharmacy charges", but has_itemized_breakdown's own extraction definition
// (synthesize.md) is voucher-type-agnostic, so before this scoping the check fired on any
// voucher type (verified against real data 2026-08-24: a jd2 optical voucher with no
// itemized frame/lens/exam breakdown was flagged with this pharmacy-specific wording,
// which is misleading for a non-pharmacy claim). Non-pharmacy vouchers lacking a breakdown
// are deliberately not flagged under this line until/unless business approves a
// generalized wording — this isn't a coverage gap being silently accepted, it's staying
// within what the approved customer-facing text actually says.
function checkMissingVoucherBreakdown(fields) {
  if (fields.invoices?.present !== true) return null;
  const anyMissingBreakdown = (fields.invoices.items || []).some(
    (item) => item.voucher_type === 'pharmacy' && item.has_itemized_breakdown === false
  );
  return anyMissingBreakdown ? ISSUES.MISSING_VOUCHER_BREAKDOWN : null;
}

/**
 * Sums every voucher's own subtotal before comparing to the form's claimed amount — a
 * case can have more than one voucher (e.g. a hospital receipt + a separate pharmacy
 * receipt), and the claimed total is meant to match their combined subtotal, not any
 * single one of them (verified against real data: 45,000 + 9,690 = 54,690).
 * A zero/negative subtotal is a refund or cash-return slip, not a voucher (2026-10-01, case
 * df3ec579: a -5,250 return slip was summed as the voucher total) — skipped here and in the two
 * sums below, which must agree with this one.
 */
function checkVoucherAmountMismatch(fields) {
  if (fields.invoices?.present !== true) return null;
  const subtotals = (fields.invoices.items || []).map((item) => item.subtotal).filter((amount) => amount > 0);
  if (subtotals.length === 0) return null; // no readable amount on any voucher — nothing to compare
  const voucherTotal = subtotals.reduce((sum, amount) => sum + amount, 0);
  const claimedAmount = fields.claim.total_claim_amount;
  if (claimedAmount == null) return null;
  return voucherTotal !== claimedAmount ? ISSUES.VOUCHER_AMOUNT_MISMATCH : null;
}

/**
 * Deterministic, code-only confidence for the checklist display — no LLM call, no schema
 * change, computed purely from the same two numbers checkVoucherAmountMismatch above already
 * compares. `confidence` here isn't "is this check sure of its own pass/fail" (it always is,
 * it's an arithmetic comparison) — it's "how much do these two independently-arrived-at
 * numbers agree", which is the useful signal for a reviewer: a 1% gap reads very differently
 * than a 50% one. Verified against real data (2026-09-16, case
 * 90a3c71e-9dc3-4003-bc63-2271cc1c607e): a single-digit OCR misread (176,000 read as 196,000)
 * produced exactly this shape of small, single-voucher-sized gap — much more likely a
 * transcription error than a genuinely missing/extra voucher, which a reviewer skimming a
 * confidence score can triage faster than re-deriving the arithmetic themselves.
 */
function voucherAmountAgreement(fields) {
  if (fields.invoices?.present !== true) return null;
  const subtotals = (fields.invoices.items || []).map((item) => item.subtotal).filter((amount) => amount > 0);
  if (subtotals.length === 0) return null;
  const voucherTotal = subtotals.reduce((sum, amount) => sum + amount, 0);
  const claimedAmount = fields.claim?.total_claim_amount;
  if (claimedAmount == null) return null;

  if (voucherTotal === claimedAmount) {
    return { confidence: 1, note: `Voucher total (${voucherTotal.toLocaleString()}) matches the claimed amount exactly.` };
  }

  const diff = Math.abs(voucherTotal - claimedAmount);
  const relativeDiff = diff / Math.max(voucherTotal, claimedAmount, 1);
  return {
    confidence: Math.max(0, 1 - relativeDiff),
    note: `Voucher total (${voucherTotal.toLocaleString()}) differs from the claimed amount (${claimedAmount.toLocaleString()}) by ${diff.toLocaleString()} (${(relativeDiff * 100).toFixed(1)}%).`,
  };
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
//
// Flags `!== true` (both `false` and `null`), not just `=== false`. This is an authenticity
// check — "extraction couldn't confirm a legitimate stamp" must not silently pass the same
// as "confirmed present", or the check is defeated by exactly the uncertainty it exists to
// catch. Verified against real data before widening it (2026-08-24): re-running against
// live cases, both known-complete samples (Hlaing Myo Oo, Moe Thida) have this field as
// `true` on every voucher; the jd1 Shin Minn Thi case — this check's own reference
// example — came back `null` on all three (not `false` as whenever the comment above was
// last verified), which silently defeated the check. `!== true` re-catches that case
// without creating false positives on the two complete samples.
function checkIncorrectVoucher(fields) {
  if (fields.invoices?.present !== true) return null;
  const anyMissingStamp = (fields.invoices.items || []).some((item) => item.has_clinic_stamp_or_doctor_signature !== true);
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
//
// Fix 2 (2026-08-24): originally fired on bank_account_holder_consistent === false alone,
// with no way to ever resolve — a submitted delegation_letter doesn't change either name
// that comparison is over, so replying with one didn't change the outcome (case would loop
// forever on this same issue). Now passes on presence of a delegation_letter alone.
//
// Fix 3 (2026-08-25): dropped the additional `legible === true` requirement this fix
// originally had. legible is a document-level judgment call (verified against real data,
// incomplete/jd2, Khin Maung: a delegation letter the model correctly found `present: true`
// on, with a clearly legible printed template, still came back `legible: false` just because
// some handwritten signature-block values were individually hard to read) — too unreliable
// to gate a customer-facing "please resend" request on. This check now only confirms the
// letter is included at all; delegator_name/delegator_nrc/authorized_payee_name/
// authorized_payee_contact/legible are still extracted and recorded on the case as-is (see
// synthesize.md, claim-recognition/service.js's normalizeIdentityConsistency) for the record,
// just not used to gate this check.
//
// REVIVED 2026-09-14: was inert since Task 3's removal took away this check's only input
// (identity_consistency.bank_account_holder_consistent — see
// db/migrations/20260914100000-remove-identity-consistency.js). No longer lives here as a
// synchronous EVALUATORS entry — it's now driven by a real judgment call
// (modules/document-checking/identityJudgment.js's entityMatch, run from service.js) and
// evaluated in evaluateJudgmentDependentChecks below, alongside the SOP §8 comparisons
// (patient/provider/hospital name, delegation-payee) that were removed at the same time
// and never rebuilt until now. Same trigger logic as always: bank-account-holder judged
// inconsistent AND no delegation letter present.
//
// DEMO-SCOPED SIMPLIFICATION, still true: does not also require
// delegation_letter_authorizes_payee (does the letter's named payee actually match
// bank.bank_account_name) — any included delegation letter clears this, even one that
// doesn't name the bank-account holder as payee. That's item 14 (delegation-payee
// consistency, now built as its own flag below) — informational for now, not yet required
// to clear this gate. Tighten by requiring judgments.delegationPayee?.consistent === true
// too once that flag has been validated against enough real cases.

// Static per-code descriptions for the SOP §7/§8/§9/§10 entity-consistency flags — same
// {code, desc, reason, confidence} shape as every other flag in this file.
const IDENTITY_FLAG_DESCRIPTIONS = {
  DELEGATION_PAYEE_INCONSISTENT: "The delegation letter's named payee does not appear to match the bank account holder name.",
  PATIENT_NAME_INCONSISTENT: 'The claimant name on the claim form does not appear to match the patient name on the medical record.',
  PROVIDER_NAME_INCONSISTENT: 'The doctor name on the claim form does not appear to match the doctor name on the medical record.',
  HOSPITAL_NAME_INCONSISTENT: 'The hospital/clinic name on the claim form does not appear to match the hospital/clinic name on the medical record.',
  DIAGNOSIS_TREATMENT_INCONSISTENT: "The medical record does not appear to support the claim form's stated diagnosis/treatment.",
};

// Single source of {code, label} for every judgment-dependent checklist item — used both by
// evaluateJudgmentDependentChecks below (when judgments actually ran) and by
// pendingJudgmentChecklist (when they didn't — see that function's own comment). Keeping one
// map means the console's list of "what SOP §7/§8/§9/§10 checks exist" can't drift out of
// sync between the real and placeholder cases.
const JUDGMENT_CHECKLIST_LABELS = {
  DELEGATION_LETTER_REQUIRED: 'Bank account holder matches claimant, or a delegation letter is provided',
  ...IDENTITY_FLAG_DESCRIPTIONS,
};

/**
 * Pure — no I/O, same as evaluateDocumentChecks below, just takes judgment results as data
 * (computed by entityMatch, run from service.js) instead of computing them itself. Keeps
 * this file's whole no-I/O invariant intact and every check here testable with synthetic
 * `judgments` input via the existing fixture harness (tests/documentChecking.test.js) —
 * no LLM call needed to test this function's logic, only to test entityMatch itself.
 *
 * `judgments` shape: { bankAccountHolder, delegationPayee, patientName, providerName,
 * hospitalName, diagnosisTreatment }, each either null (judgment didn't run / couldn't
 * determine) or { consistent, confidence, reason } from entityMatch/meaningMatch.
 *
 * Doctor name and hospital/clinic name are judged as two SEPARATE comparisons
 * (providerName/hospitalName) rather than bundled the way the old
 * medical_record_provider_consistent field was — SOP §8's own table lists "Doctor Name"
 * and "Hospital/Clinic Name" as two separate rows, each with its own requirement, so this
 * is more faithful to the SOP, not just a refactor.
 */
function evaluateJudgmentDependentChecks(extractedFields, judgments = {}) {
  const issues = [];
  const details = [];
  const flags = [];

  if (judgments.bankAccountHolder?.consistent === false) {
    const authorized = extractedFields.delegation_letter?.present === true;
    if (!authorized) {
      issues.push(ISSUES.DELEGATION_LETTER_REQUIRED);
      details.push({
        issue: ISSUES.DELEGATION_LETTER_REQUIRED,
        code: 'DELEGATION_LETTER_REQUIRED',
        reason: `Bank-account-holder judgment: ${judgments.bankAccountHolder.reason} (confidence ${judgments.bankAccountHolder.confidence}). No delegation letter is present to authorize this payee.`,
      });
    }
  }

  const addFlagIfInconsistent = (code, judgment) => {
    if (judgment?.consistent === false) {
      const flag = { code, desc: IDENTITY_FLAG_DESCRIPTIONS[code], reason: judgment.reason, confidence: judgment.confidence };
      flags.push(flag);
      details.push({ issue: IDENTITY_FLAG_ISSUES[code], code, reason: flag.reason });
    }
  };
  addFlagIfInconsistent('DELEGATION_PAYEE_INCONSISTENT', judgments.delegationPayee);
  addFlagIfInconsistent('PATIENT_NAME_INCONSISTENT', judgments.patientName);
  addFlagIfInconsistent('PROVIDER_NAME_INCONSISTENT', judgments.providerName);
  addFlagIfInconsistent('HOSPITAL_NAME_INCONSISTENT', judgments.hospitalName);
  addFlagIfInconsistent('DIAGNOSIS_TREATMENT_INCONSISTENT', judgments.diagnosisTreatment);

  // Same internal-only checklist contract as buildEvaluatorChecklist above — `passed` is
  // `null` (not true/false) when the judgment didn't run at all (fields missing on one
  // side), so the console can distinguish "checked, fine" from "couldn't be checked",
  // rather than collapsing both into a false "passed". confidence/note surface the SAME
  // entityMatch/meaningMatch output (identityJudgment.js) already used to decide `passed` —
  // previously computed and then discarded once `consistent` was read; purely additive,
  // no LLM call added and no change to what fires/passes.
  const checklist = [
    {
      code: 'DELEGATION_LETTER_REQUIRED',
      label: JUDGMENT_CHECKLIST_LABELS.DELEGATION_LETTER_REQUIRED,
      passed: judgments.bankAccountHolder?.consistent == null ? null : !issues.includes(ISSUES.DELEGATION_LETTER_REQUIRED),
      confidence: judgments.bankAccountHolder?.confidence ?? null,
      note: judgments.bankAccountHolder?.reason ?? null,
    },
    {
      code: 'DELEGATION_PAYEE_INCONSISTENT',
      label: JUDGMENT_CHECKLIST_LABELS.DELEGATION_PAYEE_INCONSISTENT,
      passed: judgments.delegationPayee == null ? null : judgments.delegationPayee.consistent !== false,
      confidence: judgments.delegationPayee?.confidence ?? null,
      note: judgments.delegationPayee?.reason ?? null,
    },
    {
      code: 'PATIENT_NAME_INCONSISTENT',
      label: JUDGMENT_CHECKLIST_LABELS.PATIENT_NAME_INCONSISTENT,
      passed: judgments.patientName == null ? null : judgments.patientName.consistent !== false,
      confidence: judgments.patientName?.confidence ?? null,
      note: judgments.patientName?.reason ?? null,
    },
    {
      code: 'PROVIDER_NAME_INCONSISTENT',
      label: JUDGMENT_CHECKLIST_LABELS.PROVIDER_NAME_INCONSISTENT,
      passed: judgments.providerName == null ? null : judgments.providerName.consistent !== false,
      confidence: judgments.providerName?.confidence ?? null,
      note: judgments.providerName?.reason ?? null,
    },
    {
      code: 'HOSPITAL_NAME_INCONSISTENT',
      label: JUDGMENT_CHECKLIST_LABELS.HOSPITAL_NAME_INCONSISTENT,
      passed: judgments.hospitalName == null ? null : judgments.hospitalName.consistent !== false,
      confidence: judgments.hospitalName?.confidence ?? null,
      note: judgments.hospitalName?.reason ?? null,
    },
    {
      code: 'DIAGNOSIS_TREATMENT_INCONSISTENT',
      label: JUDGMENT_CHECKLIST_LABELS.DIAGNOSIS_TREATMENT_INCONSISTENT,
      passed: judgments.diagnosisTreatment == null ? null : judgments.diagnosisTreatment.consistent !== false,
      confidence: judgments.diagnosisTreatment?.confidence ?? null,
      note: judgments.diagnosisTreatment?.reason ?? null,
    },
  ];

  return { issues: [...new Set([...issues, ...flags.map(issueForFlag).filter(Boolean)])], details, flags, checklist };
}

const IDENTITY_FLAG_ISSUES = {
  DELEGATION_PAYEE_INCONSISTENT: 'The delegation letter payee does not match the bank account holder. Please provide clarification or an updated delegation letter.',
  PATIENT_NAME_INCONSISTENT: 'The patient name is not consistent between the claim form and medical record. Please provide clarification or supporting documentation.',
  PROVIDER_NAME_INCONSISTENT: 'The doctor name is not consistent between the claim form and medical record. Please provide clarification or supporting documentation.',
  HOSPITAL_NAME_INCONSISTENT: 'The hospital or clinic name is not consistent between the claim form and medical record. Please provide clarification or supporting documentation.',
  DIAGNOSIS_TREATMENT_INCONSISTENT: 'The medical record does not clearly support the diagnosis or treatment stated on the claim form. Please provide clarification or supporting documentation.',
};

function issueForFlag(flag) {
  if (flag.code === 'MISSING_MANDATORY_FIELD') return `Please provide the missing ${flag.field.toLowerCase()}.`;
  if (flag.code === 'TREATMENT_DATE_INCONSISTENT') return 'The treatment date is not consistent across the submitted documents. Please provide clarification or corrected documents.';
  if (flag.code === 'INVOICE_DATE_INCONSISTENT') return 'The invoice date is not consistent with the medical record date. Please provide clarification or a corrected invoice.';
  return IDENTITY_FLAG_ISSUES[flag.code] || null;
}

function reasonForFlag(flag) {
  if (flag.code === 'MISSING_MANDATORY_FIELD') return `${flag.field} is missing or could not be confirmed in the submitted documents.`;
  if (flag.code === 'TREATMENT_DATE_INCONSISTENT') return `Claim date ${flag.claimDate} does not match medical-record date ${flag.medicalRecordDate}.`;
  if (flag.code === 'INVOICE_DATE_INCONSISTENT') return `Invoice #${flag.voucherIndex} date ${flag.invoiceDate} does not match medical-record date ${flag.medicalRecordDate}.`;
  return flag.reason || null;
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
// checkDelegationLetterRequired is deliberately NOT in this list — it moved to
// evaluateJudgmentDependentChecks below, since it now depends on a real judgment call
// (entityMatch), which this array's synchronous, no-I/O contract can't accommodate.
const EVALUATORS = [
  { code: 'INCOMPLETE_CLAIM_FORM', check: checkIncompleteClaimForm },
  { code: 'MISSING_VOUCHER', check: checkMissingVoucher },
  { code: 'NO_MEDICAL_REPORT', check: checkNoMedicalReport },
  { code: 'EYE_TEST_SLIP_UNDATED', check: checkEyeTestSlipUndated },
  { code: 'UNCLEAR_VOUCHER', check: checkUnclearVoucher },
  { code: 'INCORRECT_VOUCHER', check: checkIncorrectVoucher },
  { code: 'MISSING_VOUCHER_BREAKDOWN', check: checkMissingVoucherBreakdown },
  { code: 'VOUCHER_AMOUNT_MISMATCH', check: checkVoucherAmountMismatch },
  { code: 'INCOMPLETE_MEDICAL_REPORT', check: checkIncompleteMedicalReport },
  { code: 'MISSING_BANK_INFO', check: checkMissingBankInfo },
];

/**
 * Re-derives a plain-English "why" for one already-decided issue, straight from
 * extractedFields — the same evidence each check function above computed internally to
 * decide pass/fail, but never returned. Keyed by the exact ISSUES.* text so it can never
 * drift out of sync with whichever checks actually fired. Purely additive/read-only: does
 * not change any check function above, does not affect issues[]/passed, and callers that
 * only read issues[]/passed (email templates, dedupe, CaseEvent messages) are unaffected.
 */
function reasonForIssue(issue, fields) {
  const invoiceItems = fields.invoices?.items || [];
  const indexed = (predicate) =>
    invoiceItems
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => predicate(item))
      .map(({ i }) => `#${i + 1}`)
      .join(', ');
  const mmk = (amount) => `${Number(amount).toLocaleString('en-US')} MMK`;

  switch (issue) {
    case ISSUES.INCOMPLETE_CLAIM_FORM:
      return {
        code: 'INCOMPLETE_CLAIM_FORM',
        reason: 'The claim form does not describe the illness/injury or the treatment (section B is empty).',
      };
    case ISSUES.MISSING_VOUCHER:
      return { code: 'MISSING_VOUCHER', reason: 'No voucher or invoice was attached to the claim.' };
    case ISSUES.NO_MEDICAL_REPORT:
      return { code: 'NO_MEDICAL_REPORT', reason: 'No medical report or doctor\'s record was attached to the claim.' };
    case ISSUES.EYE_TEST_SLIP_UNDATED: {
      const pages = undatedEyeTestSlips(fields).map((d) => d.page).filter(Boolean);
      return { code: 'EYE_TEST_SLIP_UNDATED', reason: `The eye test slip shows no treatment date${pages.length ? ` (${pages.join(', ')})` : ''}.` };
    }
    case ISSUES.UNCLEAR_VOUCHER:
      return {
        code: 'UNCLEAR_VOUCHER',
        reason: `Voucher(s) ${indexed((item) => item.legible === false)} cannot be read clearly.`,
      };
    case ISSUES.INCORRECT_VOUCHER:
      return {
        code: 'INCORRECT_VOUCHER',
        reason: `Voucher(s) ${indexed((item) => item.has_clinic_stamp_or_doctor_signature !== true)} do not show a clinic/hospital stamp or the doctor's signature.`,
      };
    case ISSUES.MISSING_VOUCHER_BREAKDOWN:
      return {
        code: 'MISSING_VOUCHER_BREAKDOWN',
        reason: `Pharmacy voucher(s) ${indexed((item) => item.voucher_type === 'pharmacy' && item.has_itemized_breakdown === false)} do not list the individual medicines and their prices.`,
      };
    case ISSUES.VOUCHER_AMOUNT_MISMATCH: {
      const subtotals = invoiceItems.map((item) => item.subtotal).filter((amount) => amount > 0);
      const voucherTotal = subtotals.reduce((sum, amount) => sum + amount, 0);
      return {
        code: 'VOUCHER_AMOUNT_MISMATCH',
        reason: `The vouchers add up to ${mmk(voucherTotal)}, but the claimed amount is ${mmk(fields.claim.total_claim_amount)}.`,
      };
    }
    case ISSUES.INCOMPLETE_MEDICAL_REPORT:
      return { code: 'INCOMPLETE_MEDICAL_REPORT', reason: 'The medical report is attached but cannot be read clearly.' };
    case ISSUES.MISSING_BANK_INFO:
      return { code: 'MISSING_BANK_INFO', reason: 'The bank name, account holder name and account number are all missing.' };
    // DELEGATION_LETTER_REQUIRED is no longer decided in EVALUATORS (see
    // evaluateJudgmentDependentChecks) — this function is only ever called on issues that
    // fired from EVALUATORS, so that case can't reach here; its own reason/details are
    // constructed directly in evaluateJudgmentDependentChecks instead, using the actual
    // judgment's stated reasoning rather than a hardcoded sentence.
    default:
      return { code: null, reason: null };
  }
}

// Non-blocking completeness flags (SOP §4 mandatory-field table + §10's signature line) —
// deliberately NOT in ISSUES/EVALUATORS: these never affect `passed`/`issues`, the
// customer-facing MISSING_DOCUMENTS email, or Case.currentStatus, only the `flags` array
// below (stored on Case.documentCheckResult same as everything else this function
// returns). Shipped this way on purpose, not as an oversight — promote an individual field
// to a real blocking check only after reviewing what it actually flags against real cases.
// A hard gate that skips that review is exactly what got identity_consistency's
// patient_name_consistent/medical_record_provider_consistent disabled for false positives
// (see the block comment above EVALUATORS) — same risk applies to any of these going
// straight to a gate unreviewed.
//
// Covers every SOP §4 field NOT already gated by an existing check above: Illness/Injury
// Details (checkIncompleteClaimForm), Medical Records (checkNoMedicalReport/
// checkIncompleteMedicalReport), and Bills/Invoices (checkMissingVoucher) are already
// covered and intentionally not duplicated here. "Diagnosis" (its own row in the SOP's
// field table) has no field distinct from medical.detail_of_illness_injury in the current
// extraction schema — treated as the same field, not a second check on nothing.
//
// Member Declaration/Consent (SOP §10) is NOT checked here — there is no extracted field
// for it at all in the current schema (only documents_present.has_customer_signature
// exists; no "declaration present" boolean anywhere). Needs a schema decision (a new
// extraction field) before this can be checked, not just a flip-on — see
// docs/imp/demo/20260914/JD1_Checklist_SOP_vs_Current_System.md item 1.
const MANDATORY_FIELDS = [
  { section: 'Submission Information', field: 'Case Number', get: (f) => f.claim?.insurer_case_number },
  { section: 'Policy & Member Information', field: 'Product Type', get: (f) => f.policy?.product_name },
  { section: 'Policy & Member Information', field: 'Policy Number / Risk Name', get: (f) => f.policy?.policy_no },
  { section: 'Policy & Member Information', field: 'Company Name', get: (f) => f.policy?.company_name },
  { section: 'Policy & Member Information', field: 'Claimant Name', get: (f) => f.claimant?.claimant_name },
  { section: 'Policy & Member Information', field: 'Is Claim for Child', get: (f) => f.claimant?.is_claim_for_child },
  { section: 'Policy & Member Information', field: 'Claimant Date of Birth', get: (f) => f.claimant?.claimant_dob },
  { section: 'Policy & Member Information', field: 'NRC / Passport Number', get: (f) => f.claimant?.claimant_nrc_passport },
  { section: 'Policy & Member Information', field: 'Phone Number', get: (f) => f.claimant?.phone_number },
  { section: 'Policy & Member Information', field: 'Email', get: (f) => f.claimant?.email_address },
  { section: 'Claim & Treatment Information', field: 'Claim Benefit Type', get: (f) => f.claim?.claim_benefit_type },
  { section: 'Claim & Treatment Information', field: 'Type of Patient', get: (f) => f.claim?.type_of_patient },
  { section: 'Claim & Treatment Information', field: 'Appointment / Visited Date', get: (f) => f.claim?.appointment_date },
  // SOP §4's row is "Appointment/Visited Date & Time". The time was mandatory from 2026-09-14 until 2026-10-19, when
  // the owner removed it: the staff accept "N/A" and never ask the customer for it (AYA-CL-26043392).
  { section: 'Claim & Treatment Information', field: 'Hospital / Clinic Name', get: (f) => f.medical?.hospital_or_clinic_name },
  { section: 'Claim & Treatment Information', field: 'Claim Amount', get: (f) => f.claim?.total_claim_amount },
  // SOP §9 treats Bank Name/Address/Account Holder Name/Account Number as four separate
  // mandatory confirmations. The existing checkMissingBankInfo (below, blocking) only
  // fires when all three of bank_name/bank_account_name/bank_account_number are missing
  // *together*, and never checks bank_address at all — a claim missing just one of the
  // four passes that check silently. These four flags close that gap the same
  // non-blocking way as everything else in this list; checkMissingBankInfo is untouched,
  // still the blocking "all three missing" gate it always was.
  { section: 'Bank Information', field: 'Bank Name', get: (f) => f.bank?.bank_name },
  { section: 'Bank Information', field: 'Bank Address / Branch', get: (f) => f.bank?.bank_address },
  { section: 'Bank Information', field: 'Account Holder Name', get: (f) => f.bank?.bank_account_name },
  { section: 'Bank Information', field: 'Account Number', get: (f) => f.bank?.bank_account_number },
  // Unlike every field above (where only `null` means missing — `false` is a legitimate,
  // complete answer for a boolean like is_claim_for_child), a signature is only confirmed
  // present when this is exactly `true`; both `null` and `false` mean "not confirmed."
  {
    section: 'Declaration & Signature',
    field: 'Customer Signature',
    get: (f) => f.documents_present?.has_customer_signature,
    isMissing: (value) => value !== true,
  },
];

function evaluateMandatoryFieldFlags(fields) {
  return MANDATORY_FIELDS.filter(({ get, isMissing = (value) => value == null }) => isMissing(get(fields)))
    .map(({ section, field }) => ({ code: 'MISSING_MANDATORY_FIELD', section, field }));
}

// SOP §8's Cross-Document Consistency table, Treatment Date row: JD1 Rule is specifically
// "Medical Record and Invoice Date Must Match / Be Consistent" — that pairing (not Claim
// Form) is the SOP's own literal match requirement, now checkable since invoices.items[].date
// was added (db/migrations/20260914110000-add-invoice-date-and-medical-record-diagnosis.js).
// Claim Form vs Medical Record is also checked below — a reasonable superset SOP doesn't
// explicitly forbid, kept from the original version of this check.
//
// Deliberately NOT judgment — unlike name matching (which needs script/honorific-aware
// comparison, hence the future identity-judgment module in this file's domain), dates are
// already normalized to ISO YYYY-MM-DD strings during extraction (see claim-recognition/
// prompts/extract-fields.md's date rule), so every comparison here is a plain string
// compare, Tier-2 code, no LLM call needed at all.
//
// Same accident_date -> appointment_date fallback as member-verification/checks.js's own
// treatment-date resolution (an illness claim has no accident_date; appointment_date is the
// real visit date) — reused here rather than reinvented, for the same reason it's used
// there.
function checkTreatmentDateConsistency(fields) {
  const flags = [];
  const claimDate = fields.claim?.accident_date || fields.claim?.appointment_date;
  const medicalRecordDate = fields.medical_record?.date;

  if (claimDate != null && medicalRecordDate != null && claimDate !== medicalRecordDate) {
    flags.push({ code: 'TREATMENT_DATE_INCONSISTENT', claimDate, medicalRecordDate });
  }

  if (medicalRecordDate != null) {
    (fields.invoices?.items || []).forEach((item, index) => {
      if (item.date != null && item.date !== medicalRecordDate) {
        flags.push({ code: 'INVOICE_DATE_INCONSISTENT', voucherIndex: index + 1, medicalRecordDate, invoiceDate: item.date });
      }
    });
  }

  return flags.length > 0 ? flags : null;
}

// Full checklist for the internal console (SOP items covered by EVALUATORS + the
// mandatory-field table + the date-consistency checks) — every item that was actually
// evaluated, pass or fail, not just the ones that fired. Deliberately NOT read by anything
// customer-facing: modules/document-checking/service.js's email payload only ever reads
// `issues`/`details`, and this key is additive to that same result object, so it can't leak
// into the MISSING_DOCUMENTS email. Internal wording only — reuses ISSUES.* verbatim as the
// label since that's already the one source of truth for what each check is about; an
// internal reader seeing "Missing voucher(s): passed" is unambiguous.
// Confidence/reason live on medical_record/invoices themselves (see extract-fields.md's
// presence_confidence/presence_reason, and invalidateCopiedMedicalRecord's own override) —
// surfaced here only for the two checklist items whose pass/fail IS that same presence
// determination, so the console can show *why*, not just pass/fail. No equivalent score
// exists for any other EVALUATORS entry.
// One {confidence, note} shape for every checklist item that has one, regardless of where the
// number actually comes from — the model's own self-reported presence_confidence for the two
// presence checks, or a purely deterministic agreement score (voucherAmountAgreement) for the
// amount check. The checklist/console side doesn't need to know which.
function presenceConfidence(source) {
  if (source?.presence_confidence == null) return null;
  return { confidence: source.presence_confidence, note: source.presence_reason ?? null };
}

const lowestScore = (pages) => {
  const scores = pages.map((d) => d.confidence).filter((c) => typeof c === 'number');
  return scores.length ? Math.min(...scores) : null;
};
const slipText = (d, tail) => `${d.reason || 'eye test slip'}${tail}${d.page ? ` (${d.page})` : ''}`;
const doctorPagesText = (pages) => `${pages.map((d) => `${DOCUMENT_KIND_LABELS[d.kind]}${d.page ? ` (${d.page})` : ''}`).join('; ')}`;

const CHECKLIST_CONFIDENCE = {
  // A vision claim's eye test slip passes the medical record line: its score and reason, not the AI's "no medical
  // record" (which reads like a failure on a passed line).
  NO_MEDICAL_REPORT: (fields) => {
    const slips = trustedEyeTestSlips(fields);
    if (fields.medical_record?.present !== true && slips.length) {
      return { confidence: lowestScore(slips), note: `An eye test slip was found; for a vision claim it is the medical record (${slips.map((d) => slipText(d, '')).join('; ')}).` };
    }
    const pages = trustedDoctorPages(fields);
    if (fields.medical_record?.present !== true && pages.length) {
      return { confidence: lowestScore(pages), note: `The doctor's pages were found: ${doctorPagesText(pages)}.` };
    }
    return presenceConfidence(fields.medical_record);
  },
  MISSING_VOUCHER: (fields) => presenceConfidence(fields.invoices),
  VOUCHER_AMOUNT_MISMATCH: voucherAmountAgreement,
  // The least sure undated slip: at or below the threshold it is unsure, so the customer email is held for a person
  // (switch "hold the missing-documents email when the AI is unsure", holdForReview.js).
  EYE_TEST_SLIP_UNDATED: (fields) => {
    const undated = undatedEyeTestSlips(fields);
    if (!undated.length) return null;
    return { confidence: lowestScore(undated), note: `${undated.map((d) => slipText(d, ' — no date')).join('; ')}.` };
  },
};

// Why a check passed (SYSTEM_4 E4-08: a reason on every result, pass or fail), from the same values the check read.
// A failed check's reason is reasonForIssue's. Voucher numbers as in reasonForIssue (#1, #2, …).
function passReason(code, fields) {
  const items = fields.invoices?.items || [];
  const vouchers = items.length === 1 ? 'the voucher' : `all ${items.length} vouchers`;
  const noVoucher = 'No voucher to check.';
  switch (code) {
    case 'INCOMPLETE_CLAIM_FORM':
      return 'The claim form describes the illness/injury or the treatment (section B).';
    case 'MISSING_VOUCHER':
      return fields.invoices?.present === true ? `${items.length || 'A'} voucher(s) found.` : "The AI couldn't tell whether a voucher is attached.";
    case 'NO_MEDICAL_REPORT':
      if (fields.medical_record?.present === true) return 'A medical record was found.';
      if (trustedEyeTestSlips(fields).length) return 'An eye test slip was found; for a vision claim it is the medical record.';
      return trustedDoctorPages(fields).length ? `The doctor's pages were found: ${doctorPagesText(trustedDoctorPages(fields))}.` : "The AI couldn't tell whether a medical record is attached.";
    case 'EYE_TEST_SLIP_UNDATED':
      return 'Every eye test slip shows a date.';
    case 'UNCLEAR_VOUCHER':
      return fields.invoices?.present === true ? `No voucher marked unreadable (${vouchers}).` : noVoucher;
    case 'INCORRECT_VOUCHER':
      return fields.invoices?.present === true ? `A clinic/hospital stamp or the doctor's signature on ${vouchers}.` : noVoucher;
    case 'MISSING_VOUCHER_BREAKDOWN':
      if (fields.invoices?.present !== true) return noVoucher;
      return items.some((item) => item.voucher_type === 'pharmacy') ? 'Every pharmacy voucher lists its items.' : 'No pharmacy voucher.';
    case 'VOUCHER_AMOUNT_MISMATCH':
      return 'Nothing to compare: no voucher amount or no claimed amount was read.'; // when compared, the note says it
    case 'INCOMPLETE_MEDICAL_REPORT':
      return fields.medical_record?.present === true ? 'The medical record is readable.' : 'No medical record to read.';
    case 'MISSING_BANK_INFO': {
      const bank = fields.bank || {};
      const found = [['bank name', bank.bank_name], ['account holder', bank.bank_account_name], ['account number', bank.bank_account_number]]
        .filter(([, value]) => value).map(([label]) => label);
      return `Found: ${found.join(', ')}.`;
    }
    default:
      return null;
  }
}

function buildEvaluatorChecklist(extractedFields) {
  // The eye test slip line only where there is an eye test slip: elsewhere it does not apply (not "passed").
  return EVALUATORS.filter(({ code }) => code !== 'EYE_TEST_SLIP_UNDATED' || eyeTestSlips(extractedFields).length).map(({ code, check }) => {
    const extra = CHECKLIST_CONFIDENCE[code]?.(extractedFields) ?? null;
    const issue = check(extractedFields);
    return {
      code,
      label: ISSUES[code],
      passed: issue == null,
      confidence: extra?.confidence ?? null,
      note: extra?.note ?? null,
      reason: extra?.note ?? (issue ? reasonForIssue(issue, extractedFields).reason : passReason(code, extractedFields)),
    };
  });
}

// Found / not found is the whole reason here — no separate text.
function buildMandatoryFieldChecklist(extractedFields) {
  return MANDATORY_FIELDS.map(({ section, field, get, isMissing = (value) => value == null }) => ({
    code: 'MISSING_MANDATORY_FIELD',
    label: `${section}: ${field}`,
    passed: !isMissing(get(extractedFields)),
  }));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

// Deterministic, code-only confidence for the two date-consistency checklist items below —
// same reasoning as voucherAmountAgreement above: "how much do these two independently
// extracted dates agree" is a more useful signal than a flat pass/fail. A 1-day gap is far
// more likely a data-entry slip (off-by-one, timezone rounding at midnight) than a genuinely
// different visit; a 60-day gap is not. Confidence decays to 0 by
// DATE_CONFIDENCE_FLOOR_DAYS apart — a deliberately simple straight-line falloff, not a
// claim about real-world date-error distributions.
const DATE_CONFIDENCE_FLOOR_DAYS = 14;

function dateAgreement(dateA, dateB, labelA, labelB) {
  if (dateA == null || dateB == null) return null;
  if (dateA === dateB) return { confidence: 1, note: `${labelA} and ${labelB} both ${dateA}.` };
  const days = daysBetween(dateA, dateB);
  if (days == null) return null;
  return {
    confidence: Math.max(0, 1 - days / DATE_CONFIDENCE_FLOOR_DAYS),
    note: `${labelA} (${dateA}) differs from ${labelB} (${dateB}) by ${days} day(s).`,
  };
}

function buildDateConsistencyChecklist(extractedFields) {
  const dateFlags = checkTreatmentDateConsistency(extractedFields) || [];
  const claimDate = extractedFields.claim?.accident_date || extractedFields.claim?.appointment_date;
  const medicalRecordDate = extractedFields.medical_record?.date;
  const treatmentAgreement = dateAgreement(claimDate, medicalRecordDate, 'Claim date', 'Medical record date');

  // A case can have more than one voucher, each with its own date — report the worst
  // (lowest-confidence) agreement found, same "one representative reason" approach the
  // issues[] line already takes for this check (one INVOICE_DATE_INCONSISTENT issue text
  // covers every mismatched voucher, not one line each).
  const invoiceAgreements = (extractedFields.invoices?.items || [])
    .map((item, index) => dateAgreement(item.date, medicalRecordDate, `Voucher ${index + 1} date`, 'Medical record date'))
    .filter((agreement) => agreement != null);
  const worstInvoiceAgreement =
    invoiceAgreements.length === 0
      ? null
      : invoiceAgreements.reduce((worst, agreement) => (agreement.confidence < worst.confidence ? agreement : worst));

  return [
    {
      code: 'TREATMENT_DATE_INCONSISTENT',
      label: 'Treatment date is consistent with medical record date',
      passed: !dateFlags.some((flag) => flag.code === 'TREATMENT_DATE_INCONSISTENT'),
      confidence: treatmentAgreement?.confidence ?? null,
      note: treatmentAgreement?.note ?? null,
      reason: treatmentAgreement?.note ?? 'Nothing to compare: no claim date or no medical record date was read.',
    },
    {
      code: 'INVOICE_DATE_INCONSISTENT',
      label: 'Invoice date(s) are consistent with medical record date',
      passed: !dateFlags.some((flag) => flag.code === 'INVOICE_DATE_INCONSISTENT'),
      confidence: worstInvoiceAgreement?.confidence ?? null,
      note: worstInvoiceAgreement?.note ?? null,
      reason: worstInvoiceAgreement?.note ?? 'Nothing to compare: no voucher date or no medical record date was read.',
    },
  ];
}

function evaluateDocumentChecks(extractedFields) {
  const entries = evidenceEntries(extractedFields);
  const flags = [...evaluateMandatoryFieldFlags(extractedFields), ...(checkTreatmentDateConsistency(extractedFields) || [])];
  const issues = [...new Set([
    ...EVALUATORS.map(({ check }) => check(extractedFields)).filter(Boolean),
    ...flags.map(issueForFlag).filter(Boolean),
  ])];
  const details = [
    ...issues.map((issue) => ({ issue, ...reasonForIssue(issue, extractedFields) })),
    ...flags.map((flag) => ({ issue: issueForFlag(flag), code: flag.code, reason: reasonForFlag(flag) })),
  ];
  const checklist = [
    ...buildEvaluatorChecklist(extractedFields),
    ...buildMandatoryFieldChecklist(extractedFields),
    ...buildDateConsistencyChecklist(extractedFields),
  ].map((item) => withFieldConfidence(item, entries))
    .map((item) => (CHECK_FIELDS[item.code] ? { ...item, editItems: editItemsFor(item.code, extractedFields) } : item));
  return { issues, passed: issues.length === 0, details, flags, checklist };
}

// Vitamins / supplements on the vouchers (SYSTEM_4 E4-10), from the AI's own per-voucher reading
// (invoices.items[].has_vitamin_or_supplement). Not a document problem — it is never an issue and never makes the
// documents incomplete — but with the switch "vitamins / supplements: a person approves" on, the claim never goes STP
// (stpEligibility.js) and the case shows a review point (assessment-summary). One checklist line:
// passed true = none on any voucher; false = found (vouchers: the voucher numbers); null = none found, but the AI
// couldn't tell for some voucher (unsureVouchers). No vouchers at all: no line.
// Found (owner, 2026-10-16): per voucher, its vitamin / supplement lines become one rejection — vitamin_exclude_amount
// (the amounts read, added up) and vitamin_remark ("Vit C - 10,000 MMK, Calcium D - 2,500 MMK is not covered due to
// supplement.") — which go on that voucher's IAS item as man_rej set 1 (payloadBuilder.js). The remarks are this line's
// note, so the reviewer, the team email and the IAS remark (AiSummaryRemark) carry them. The claimed amount is not
// changed. vitamin_items: { name, amount }; a plain name = an older case, no amount. A "none" the AI was unsure of
// (vitamin_confidence at or below the threshold) counts as "couldn't tell", so a person checks the bill.
const amountText = (n) => Number(n).toLocaleString('en-US');

// One voucher's rejection, or null when the AI found none on it. vitamin_exclude_amount null = no amount read, and
// vitamin_remark null = no item named (JD3 enters them in IAS).
// Currency: MMK, as the IAS payload (payloadBuilder.js) — no multi-currency support yet.
function vitaminRejection(item) {
  if (item?.has_vitamin_or_supplement !== true) return null;
  const lines = (item.vitamin_items || []).filter((v) => typeof v === 'string' || v?.name)
    .map((v) => (typeof v === 'string' ? { name: v, amount: null } : { name: v.name, amount: Number.isFinite(v.amount) ? v.amount : null }));
  const priced = lines.filter((v) => v.amount != null);
  const named = lines.map((v) => `${v.name} - ${v.amount == null ? 'amount not read' : `${amountText(v.amount)} MMK`}`).join(', ');
  const total = priced.length ? priced.reduce((sum, v) => sum + v.amount, 0) : null;
  return {
    // More than the voucher itself = a misread; IAS would refuse the item, so JD3 enters it instead.
    vitamin_exclude_amount: total != null && typeof item.subtotal === 'number' && total > item.subtotal ? null : total,
    vitamin_remark: named ? `${named} is not covered due to supplement.` : null,
  };
}

function vitaminCheck(fields) {
  const items = fields.invoices?.items || [];
  if (items.length === 0) return null;
  const numbered = (pick) => items.map((item, i) => (pick(item) ? i + 1 : null)).filter(Boolean);
  const vouchers = numbered((item) => item.has_vitamin_or_supplement === true);
  const unsureVouchers = numbered((item) => item.has_vitamin_or_supplement !== true
    && (item.has_vitamin_or_supplement !== false || isUnsure(item.vitamin_confidence)));
  const list = (ns) => `voucher${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`;
  const rejections = vouchers.map((n) => ({ voucher: n, ...vitaminRejection(items[n - 1]) }));

  return {
    code: 'VITAMIN_OR_SUPPLEMENT',
    label: 'No vitamins / supplements on the vouchers',
    passed: vouchers.length ? false : unsureVouchers.length ? null : true,
    vouchers,
    unsureVouchers,
    rejections,
    note: vouchers.length
      ? [`Vitamins / supplements on ${list(vouchers)}.`, ...rejections.filter((r) => r.vitamin_remark).map((r) => `Voucher ${r.voucher}: ${r.vitamin_remark}`)].join(' ')
      : unsureVouchers.length ? `The AI couldn't tell for ${list(unsureVouchers)} — check its items on the bill.` : null,
  };
}

// Documents found (SYSTEM_4 system checklist, step 1, owner 2026-10-19): the kind and the date of each page, from the
// AI's own document_list, each with its confidence and reason. Information only — never an issue, never unsure (no
// confidence on the line itself), so it never stops a case or blocks STP. Old cases (no list): no line.
const DOCUMENT_KIND_LABELS = {
  claim_form: 'claim form', voucher: 'voucher', itemized_invoice: 'itemized invoice', consultation_note: 'consultation note',
  discharge_summary: 'discharge summary', operation_or_procedure_note: 'operation / procedure note',
  investigation_report: 'investigation report', eye_test_slip: 'eye test slip', dental_consultation: 'dental consultation',
  vaccination_record: 'vaccination record', doctor_recommendation: "doctor's recommendation", medical_book_cover: 'medical book cover',
  prescription: 'prescription', bank_or_id_document: 'bank / ID document', delegation_letter: 'delegation letter', other: 'other',
};

// A date the AI gave that is not a real YYYY-MM-DD date is kept as read (dateRead) but not shown as the page's date.
// note: short (kind and date per page) because it goes into team emails and the IAS remark; each page's page label,
// confidence and reason stay in documents for the case and review pages.
function documentListCheck(fields) {
  if (!Array.isArray(fields.document_list) || fields.document_list.length === 0) return null;
  const documents = fields.document_list.map((d) => ({
    page: d.page ?? null,
    kind: d.kind ?? 'other',
    label: DOCUMENT_KIND_LABELS[d.kind] || d.kind || 'other',
    date: isRealDate(d.date) ? d.date : null,
    ...(d.date != null && !isRealDate(d.date) ? { dateRead: d.date } : {}),
    confidence: typeof d.confidence === 'number' ? d.confidence : null,
    reason: d.reason ?? null,
  }));
  const dateText = (d) => d.date || (d.dateRead ? `date unclear ("${d.dateRead}")` : 'no date');
  return {
    code: 'DOCUMENT_LIST',
    label: 'Documents found',
    passed: true,
    documents,
    note: `${documents.length} page${documents.length === 1 ? '' : 's'}: ${documents.map((d) => `${d.label}, ${dateText(d)}`).join('; ')}.`,
  };
}

// Benefit type (system checklist step 2, owner 2026-10-19): a rule, no AI — the IAS benefit type the documents point
// to, from "Type of Patient" on the claim form, the documents found and the optical voucher type. IAS's own benefit types
// (member data): IP Inpatient, DT Dental, VS Vision, OP Outpatient (and PA Personal Accident, not read here). IAS has
// no vaccination type: a vaccination is paid under OP, so it is "OP Outpatient (vaccination)". IAS gives no benefit
// type when the claim arrives (ClaimType is always "M"), and the claim form's claim_benefit_type is the way of payment
// (Reimbursement, …), so this is a best guess from the documents — as sure as the AI's reading of those pages.
// Information only, like the documents found: never an issue, never a review point; claim preparation's benefit pick
// for IAS is unchanged. First match wins (the order ULINK may change); other matches are named too. A doctor's
// recommendation alone is not vaccination: consultations carry them too. No document list (an older case): no line.
const INPATIENT = /\bin[\s-]?patient\b|\bIPD\b/i; // Inpatient, In-patient, In Patient, IPD
const BENEFIT_TYPES = [
  { code: 'IP', desc: 'Inpatient', kinds: ['discharge_summary'], patient: INPATIENT },
  { code: 'OP', desc: 'Outpatient', treatment: 'vaccination', kinds: ['vaccination_record'] },
  { code: 'DT', desc: 'Dental', kinds: ['dental_consultation'] },
  { code: 'VS', desc: 'Vision', kinds: ['eye_test_slip'], voucherType: 'optical' },
];
const benefitText = (t) => `${t.code} ${t.desc}${t.treatment ? ` (${t.treatment})` : ''}`;

// list: the documents-found line already built for these fields (documentListCheck).
function benefitTypeCheck(fields, list = documentListCheck(fields)) {
  if (!list) return null;
  const patient = fields.claim?.type_of_patient || null;
  const vouchers = fields.invoices?.items || [];
  const evidenceFor = ({ kinds, patient: patientRule, voucherType }) => [
    ...(patientRule && patientRule.test(patient || '') ? [`claim form: ${patient}`] : []),
    ...list.documents.filter((d) => kinds.includes(d.kind)).map((d) => `${d.label}${d.page ? `, ${d.page}` : ''}`),
    ...(voucherType ? vouchers.map((v, i) => (v.voucher_type === voucherType ? `${voucherType} voucher ${i + 1}${v.evidence?.page ? `, ${v.evidence.page}` : ''}` : null)).filter(Boolean) : []),
  ];
  const matches = BENEFIT_TYPES.map((t) => ({ ...t, evidence: evidenceFor(t) })).filter((m) => m.evidence.length);
  const [first, ...others] = matches;
  const picked = first || { code: 'OP', desc: 'Outpatient' };
  const notes = [
    first ? `${benefitText(first)} — ${first.evidence.join('; ')}`
      : `OP Outpatient — no inpatient, vaccination, dental or vision document found${patient ? `; claim form: ${patient}` : ''}`,
    others.length ? `Also: ${others.map(benefitText).join(', ')}` : null,
    picked.code === 'IP' && patient && !INPATIENT.test(patient) ? `The claim form says ${patient}` : null,
  ].filter(Boolean);
  return {
    code: 'BENEFIT_TYPE',
    label: 'Benefit type',
    passed: true,
    benefitType: { code: picked.code, desc: picked.desc, treatment: picked.treatment ?? null },
    alsoTypes: others.map((m) => ({ code: m.code, desc: m.desc, treatment: m.treatment ?? null })),
    note: `${notes.join('. ')}.`,
  };
}

// Medical documents dated (system checklist step 3, owner 2026-10-19): every medical document shows a date (the staff
// asked for a dated eye test slip in AYA-CL-26043392). A rule on the documents found, no AI. Pages that follow each
// other in the same file with the same kind are one document (a discharge summary is often dated on its first page
// only), dated if any of its pages is. Vouchers have their own date check; claim form, bank / ID, delegation letter,
// medical book cover and other are not medical documents here. A document without a date is a review point
// ("Missing information", owner 2026-10-19: prevent risky processing), never an issue: the documents stay complete and
// the customer is not asked (no approved wording yet). Like the format check: confidence 0, so with the switches it
// stops STP ("open review points block STP") and holds a passed check for a person (switch #3). No list: no line.
// Eye test slips are left out: an undated one is a customer item with the staff's wording (EYE_TEST_SLIP_UNDATED).
const MEDICAL_KINDS = new Set([
  'consultation_note', 'discharge_summary', 'operation_or_procedure_note', 'investigation_report',
  'dental_consultation', 'vaccination_record', 'doctor_recommendation', 'prescription',
]);
// One-page documents: two of them side by side are two documents (two prescriptions from two visits), never one.
const ONE_PAGE_KINDS = new Set(['eye_test_slip', 'prescription', 'doctor_recommendation']);
const fileOf = (page) => (page ? String(page).replace(/ - page \d+$/, '') : null);
// ponytail: "same kind, next page, same file" is the whole rule — a document split by another page counts as two (a
// false review point, the safe side); two separate multi-page documents side by side count as one. Ask the AI whether a
// page continues the one before if the samples show either.

// list: the documents-found line already built for these fields (documentListCheck).
function documentDatesCheck(fields, list = documentListCheck(fields)) {
  if (!list) return null;
  const groups = [];
  for (const d of list.documents) {
    const last = groups[groups.length - 1];
    const continues = last && last.kind === d.kind && !ONE_PAGE_KINDS.has(d.kind)
      && fileOf(d.page) != null && fileOf(last.pages[0].page) === fileOf(d.page);
    if (continues) last.pages.push(d);
    else groups.push({ kind: d.kind, label: d.label, pages: [d] });
  }
  const medical = groups.filter((g) => MEDICAL_KINDS.has(g.kind));
  if (medical.length === 0) return null;
  const undated = medical.filter((g) => !g.pages.some((p) => p.date)).map((g) => ({
    label: g.label,
    pages: g.pages.map((p) => p.page).filter(Boolean),
    dateRead: g.pages.map((p) => p.dateRead).find(Boolean) ?? null,
  }));
  const describe = (g) => `${g.label} has ${g.dateRead ? `an unclear date ("${g.dateRead}")` : 'no date'}${g.pages.length ? ` (${g.pages.join(', ')})` : ''}`;
  return {
    code: 'DOCUMENT_DATES',
    label: 'Medical documents dated',
    passed: true,
    confidence: undated.length ? 0 : null,
    undated,
    note: undated.length
      ? `${undated.map(describe).join('; ')}.`
      : medical.length === 1 ? 'The medical document shows a date.' : `All ${medical.length} medical documents show a date.`,
  };
}

// Format checks on the values the AI read (SYSTEM_4 E4-08): rules, no AI. A value that fails is most likely misread, so
// the line is "unsure", not an issue — confidence 0, which makes it an "AI unsure" review point (assessment-summary),
// holds a passed check for a person with switch #3 (holdForReview.js), and counts for "open review points block STP".
// Never an issue: the documents stay complete and the customer is not asked. Missing values are the mandatory-field
// check's business, not this one's. Policy / member number: no rule until ULINK confirms the formats.
const NRC_LATIN = /^\d{1,2}\/[A-Z]{2,12}\((N|E|P|T|Y|S|NAING)\)\d{6}$/i; // 12/DAGAYA(N)081441
const NRC_BURMESE = /^[\u1040-\u1049]{1,2}\/[\u1000-\u109F]+\([\u1000-\u109F]+\)[\u1040-\u1049]{6}$/; // ၁၂/ဒဂယ(နိုင်)၀၈၁၄၄၁
const PASSPORT = /^(?=.*\d)[A-Z0-9]{6,9}$/i;

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatCheck(fields, today = todayInIasTimezone()) {
  const problems = [];
  const checked = [];

  const nrc = fields.claimant?.claimant_nrc_passport;
  if (nrc != null) {
    checked.push('NRC / passport');
    const compact = String(nrc).replace(/\s+/g, '');
    if (![NRC_LATIN, NRC_BURMESE, PASSPORT].some((re) => re.test(compact))) problems.push(`NRC / passport "${nrc}" doesn't look like an NRC or passport number`);
  }

  const dates = [
    ['Date of birth', fields.claimant?.claimant_dob],
    ['Accident date', fields.claim?.accident_date],
    ['Appointment date', fields.claim?.appointment_date],
    ['Medical record date', fields.medical_record?.date],
    ...(fields.invoices?.items || []).map((item, i) => [`Voucher ${i + 1} date`, item.date]),
  ].filter(([, value]) => value != null);
  if (dates.length) checked.push('dates');
  for (const [label, value] of dates) {
    if (!isRealDate(value)) problems.push(`${label} "${value}" is not a real date`);
    else if (value > today) problems.push(`${label} ${value} is in the future`);
  }
  const dob = fields.claimant?.claimant_dob;
  const treatment = fields.claim?.accident_date || fields.claim?.appointment_date;
  if (isRealDate(dob) && isRealDate(treatment) && dob > treatment) problems.push(`Date of birth ${dob} is after the treatment date ${treatment}`);
  // A voucher dated far from the visit is most likely misread — a 7 read as a 1 moves July to January (E3 check), on
  // the voucher or on the visit date. Compared with the visit (appointment) date, the accident date when there is none;
  // the limit (days, either way) is an STP setting, default 30. This only marks the values unsure: whether the customer
  // is asked about a voucher / medical-record date mismatch stays with that check and switch #2, as before.
  const visit = fields.claim?.appointment_date || fields.claim?.accident_date;
  if (isRealDate(visit)) {
    const limit = lastReadSettings().voucherDaysBeforeVisit;
    const visitLabel = fields.claim?.appointment_date ? 'the visit (appointment) date' : 'the accident date';
    (fields.invoices?.items || []).forEach((item, i) => {
      if (!isRealDate(item.date) || item.date > today) return; // not a date, or in the future: already a problem above
      const days = Math.round((Date.parse(visit) - Date.parse(item.date)) / MS_PER_DAY);
      if (Math.abs(days) > limit) {
        problems.push(`Voucher ${i + 1} date ${item.date} is ${Math.abs(days)} days ${days > 0 ? 'before' : 'after'} ${visitLabel} ${visit}`);
      }
    });
  }

  const isAmount = (value) => typeof value === 'number' && Number.isFinite(value);
  const claimed = fields.claim?.total_claim_amount;
  if (claimed != null) {
    checked.push('amounts');
    if (!isAmount(claimed) || claimed <= 0) problems.push(`Claimed amount "${claimed}" is not an amount above zero`);
  }
  // A zero / negative subtotal is a refund slip (checkVoucherAmountMismatch) — fine; only a non-number is wrong.
  (fields.invoices?.items || []).forEach((item, i) => {
    if (item.subtotal != null && !isAmount(item.subtotal)) problems.push(`Voucher ${i + 1} amount "${item.subtotal}" is not a number`);
  });
  // The voucher's printed lines, added up by the AI (line_total, SYSTEM_4 E3b), against the total it read — not once a
  // person corrected the total (the person's amount stands; the AI's recount is of its own misreading).
  const withLines = (fields.invoices?.items || []).map((item, i) => ({ item, n: i + 1 }))
    .filter(({ item }) => isAmount(item.line_total) && isAmount(item.subtotal) && item.subtotal > 0 && !(item.evidence?.corrected || []).includes('subtotal'));
  if (withLines.length) checked.push('voucher lines');
  for (const { item, n } of withLines) {
    if (Math.abs(item.line_total - item.subtotal) >= 1) {
      problems.push(`Voucher ${n} lines add up to ${item.line_total.toLocaleString('en-US')}, but its total reads ${item.subtotal.toLocaleString('en-US')}`);
    }
  }

  if (!checked.length) return null;
  return {
    code: 'VALUE_FORMAT',
    label: 'Values read look valid',
    passed: true,
    confidence: problems.length ? 0 : null,
    problems,
    note: problems.length ? `${problems.join('; ')} — probably misread; check against the document.` : null,
    reason: problems.length ? `${problems.join('; ')}.` : `Checked: ${checked.join(', ')}.`,
  };
}

// How sure the AI was of what it read (SYSTEM_4 E3b, E4-08): the field_evidence it returned for the key fields and each
// voucher's evidence (claim-recognition/prompts/extract-fields.md). Cases read before 2026-10-15 have none: no change.
const FIELD_LABELS = {
  'claimant.claimant_name': 'Claimant name',
  'claimant.claimant_nrc_passport': 'NRC / passport',
  'claimant.claimant_dob': 'Date of birth',
  'policy.policy_no': 'Policy number',
  'claim.appointment_date': 'Appointment date',
  'claim.accident_date': 'Accident date',
  'claim.total_claim_amount': 'Claimed amount',
  'medical.hospital_or_clinic_name': 'Hospital / clinic',
  'medical.detail_of_illness_injury': 'Illness / injury',
  'medical.full_description_of_treatment': 'Treatment',
  'bank.bank_name': 'Bank name',
  'bank.bank_account_name': 'Account holder',
  'bank.bank_account_number': 'Account number',
  'medical_record.date': 'Medical record date',
};

const valueAt = (fields, path) => path.split('.').reduce((o, key) => (o == null ? o : o[key]), fields);
const percent = (confidence) => `${Math.round(confidence * 100)}%`;
// At or below the AI confidence threshold (System settings) — the same test as assessment-summary's isLowConfidence.
const isUnsure = (confidence) => typeof confidence === 'number' && confidence <= lastReadSettings().aiConfidenceThreshold;

// Every value the AI gave evidence for: { field, label, value, confidence, reason, page, voucher? }. Vouchers as
// "voucher N" (voucher: the item, so a check can pick the vouchers it compared). One entry per field: when the AI
// repeats a field, the less sure entry is kept. Only confidence / reason / page are taken from the AI's evidence.
function evidenceEntries(fields) {
  const byField = new Map();
  for (const e of Array.isArray(fields.field_evidence) ? fields.field_evidence : []) {
    if (!FIELD_LABELS[e?.field]) continue;
    const kept = byField.get(e.field);
    if (!kept || (e.confidence ?? 1) < (kept.confidence ?? 1)) byField.set(e.field, e);
  }
  const keyFields = [...byField.values()].map((e) => ({
    field: e.field, label: FIELD_LABELS[e.field], value: valueAt(fields, e.field) ?? null,
    confidence: e.confidence ?? null, reason: e.reason ?? null, page: e.page ?? null,
  }));
  const vouchers = (fields.invoices?.items || []).map((item, i) => (item.evidence ? {
    field: `voucher ${i + 1}`,
    label: `Voucher ${i + 1} amount and date`,
    value: [item.subtotal != null ? Number(item.subtotal).toLocaleString('en-US') : null, item.date].filter((v) => v != null).join(' · ') || null,
    confidence: item.evidence.confidence ?? null,
    reason: item.evidence.reason ?? null,
    page: item.evidence.page ?? null,
    voucher: item,
  } : null)).filter(Boolean);
  return [...keyFields, ...vouchers];
}

const leastSure = (entries) => entries.filter((e) => typeof e.confidence === 'number')
  .reduce((least, e) => (least == null || e.confidence < least.confidence ? e : least), null);

// The values each rule check reads. A check decided on a value the AI wasn't sure of is no surer than that value
// (E4-08: "a checklist item decided by a rule on AI-extracted data takes the confidence of the data it used").
// vouchers: which vouchers the check compared (the amount check skips refund slips; the date check, undated vouchers).
// compared: whether the check compared anything — a check that had nothing to compare used no value.
// Checks about how a document looks (legible, stamp, breakdown) and the presence checks have their own scores.
// voucherField: which value of each voucher the check compares — so the review page can offer it for correction.
const CHECK_FIELDS = {
  INCOMPLETE_CLAIM_FORM: { paths: ['medical.detail_of_illness_injury', 'medical.full_description_of_treatment'] },
  MISSING_BANK_INFO: { paths: ['bank.bank_name', 'bank.bank_account_name', 'bank.bank_account_number'] },
  VOUCHER_AMOUNT_MISMATCH: { paths: ['claim.total_claim_amount'], vouchers: (v) => v.subtotal > 0, voucherField: 'subtotal', compared: (item) => item.confidence != null },
  TREATMENT_DATE_INCONSISTENT: { paths: ['claim.appointment_date', 'claim.accident_date', 'medical_record.date'], compared: (item) => item.confidence != null },
  INVOICE_DATE_INCONSISTENT: { paths: ['medical_record.date'], vouchers: (v) => v.date != null, voucherField: 'date', compared: (item) => item.confidence != null },
};

// The values a check compared, as correction items ("claim.total_claim_amount", "invoices.items.0.subtotal") — the
// review page offers ✎ Edit for each on the check's own line (owner, 2026-10-19: fix the misread value where the
// failed check shows, not only by marking the check OK).
function editItemsFor(code, fields) {
  const uses = CHECK_FIELDS[code];
  if (!uses) return null;
  const vouchers = uses.voucherField
    ? (fields.invoices?.items || []).map((v, i) => (uses.vouchers(v) ? `invoices.items.${i}.${uses.voucherField}` : null)).filter(Boolean)
    : [];
  return [...uses.paths, ...vouchers];
}

// The same on a stored check result (cases checked before editItems existed get them when the case page loads).
function withEditItems(documentCheckResult, extractedFields) {
  if (!documentCheckResult?.checklist || !extractedFields) return documentCheckResult;
  return {
    ...documentCheckResult,
    checklist: documentCheckResult.checklist.map((item) => (CHECK_FIELDS[item.code] && !item.editItems ? { ...item, editItems: editItemsFor(item.code, extractedFields) } : item)),
  };
}

// Only a PASSED check that compared something, and only when a value it used is unsure: then the check is unsure too,
// with a note naming the value (usedFields: every unsure value it used, so "Key values read clearly" doesn't repeat
// them). A failed check stays as the rule decided it — a plainly missing item still goes to the customer
// (holdForReview.js). A check whose values were all read surely is left as it was (a rule result, not "AI self-rated").
function withFieldConfidence(item, entries) {
  const uses = CHECK_FIELDS[item.code];
  if (!uses || item.passed !== true || (uses.compared && !uses.compared(item))) return item;
  const unsure = entries.filter((e) => isUnsure(e.confidence)
    && (uses.paths.includes(e.field) || (uses.vouchers && e.voucher && uses.vouchers(e.voucher))));
  const least = leastSure(unsure);
  if (!least || (item.confidence != null && item.confidence <= least.confidence)) return item;
  const read = `Least sure value read: ${least.label} ${percent(least.confidence)}${least.reason ? ` (${least.reason})` : ''}.`;
  return { ...item, confidence: least.confidence, note: [item.note ?? item.reason, read].filter(Boolean).join(' '), usedFields: unsure.map((e) => e.field) };
}

// One checklist line for everything the AI read with its evidence (E4-08): never an issue. `fields` is what the case
// page's "What the AI read" shows — every value. Its confidence is the least sure value that no check already reports
// (checklist: the other checklist items, for their usedFields), so one doubt gives one "AI unsure" point, not two;
// that value's entry carries reportedBy for the rest.
function fieldsReadCheck(fields, checklist = []) {
  const entries = evidenceEntries(fields).map((entry) => {
    const e = { ...entry };
    delete e.voucher; // the voucher item itself is not stored with the line
    const by = checklist.find((item) => item.usedFields?.includes(e.field));
    return by ? { ...e, reportedBy: by.code } : e;
  });
  if (!entries.length) return null;
  const least = leastSure(entries);
  const leastUnreported = leastSure(entries.filter((e) => !e.reportedBy));
  return {
    code: 'FIELDS_READ',
    label: 'Key values read clearly',
    passed: true,
    confidence: leastUnreported ? leastUnreported.confidence : null,
    fields: entries,
    note: null,
    reason: least ? `${entries.length} values read; least sure: ${least.label} ${percent(least.confidence)}.` : `${entries.length} values read; no scores given.`,
  };
}

module.exports = { ISSUES, FIELD_LABELS, evaluateDocumentChecks, evaluateJudgmentDependentChecks, vitaminCheck, vitaminRejection, documentListCheck, benefitTypeCheck, documentDatesCheck, withEditItems, formatCheck, fieldsReadCheck, isRealDate, valueAt };
