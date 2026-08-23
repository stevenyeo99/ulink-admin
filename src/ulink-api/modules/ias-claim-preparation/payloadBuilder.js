const { isoToMMDDYYYY } = require('../shared/iasDates');

/**
 * Pure — no I/O. Builds the CL_CLAIM_API request shape (verified against the real sample
 * in docs/imp/day1/IAS/ias_claim_submission_api.json), given already-resolved diagnosis/
 * per-line benefit picks. Field-by-field provenance, everything not commented is a direct
 * 1:1 copy:
 *
 * - MemberRefNo/BankName/BankAcctNo/BankAcctName/PaymentMethod come from IAS's own member
 *   record (iasMemberInfoResponse), not the OCR-extracted equivalents — ground truth,
 *   already cross-checked by member-verification's hard checks.
 * - TpaCaseNumber/TpaClaimNumber, ProvPortalCaseNumber/ReviseClaimReasonCode/isValidation/
 *   isCSR are all confirmed (not guessed) — see this module's plan/PR notes. isValidation
 *   is "N" (a real submission, not a dry-run/validate-only call) — corrects an earlier
 *   assumption of "Y" that was based on the real samples always showing "Y", which
 *   turned out not to mean what it looked like.
 * - ProviderCode and the outside-Myanmar country name are accepted gaps (never extracted
 *   today) — left null rather than guessed.
 *
 * One `Items[]` entry per real voucher (`lines`, built by service.js from
 * extractedFields.invoices.items — each voucher's own subtotal + its own benefit pick), not
 * one collapsed line per case — verified against real sample data that a claim can genuinely
 * be multiple separate vouchers (complete/2: a 45,000 consultation receipt + a separate
 * 9,690 pharmacy receipt = 54,690 claim total, exactly). Diagnosis, dates, provider, and
 * bank/payee fields are shared across all lines — one underlying illness/episode of care,
 * and invoices.items[] deliberately has no per-voucher date (removed after a real
 * fabrication incident, not reintroduced — see db/migrations/20260822200000-simplify-
 * invoice-items.js), so a different visit date per voucher isn't something this can express.
 */
function buildPayload({ extractedFields, iasMemberInfoResponse, route, diagnosis, lines }) {
  const member = iasMemberInfoResponse?.payload?.member || {};
  const memberPlan = iasMemberInfoResponse?.payload?.memberPlans?.[0] || {};
  const planId = memberPlan?.plan?.PLAN_ID ?? null;

  const claim = extractedFields.claim || {};
  const medical = extractedFields.medical || {};
  const claimant = extractedFields.claimant || {};

  // Only mapping confirmed against real data so far (Hlaing Myo Oo's response had
  // SCMA_OID_CL_PAY_METHOD: "CL_PAY_METHOD_AT", and the real submission sample uses
  // "AUTOPAY") — any other code IAS might use is left null, not guessed.
  const paymentMethod = member.SCMA_OID_CL_PAY_METHOD === 'CL_PAY_METHOD_AT' ? 'AUTOPAY' : null;

  // Only the boolean is ever extracted (treatment_outside_myanmar) — no country name field
  // exists anywhere upstream for the true case, so that direction is an accepted gap.
  const treatmentCountry = claim.treatment_outside_myanmar === false ? 'MYANMAR' : null;

  const items = lines.map(({ subtotal, benefit }) => ({
    PlanId: planId,
    ClaimType: route?.claimType ?? null,
    ReceivedDate: isoToMMDDYYYY(claim.date_submitted),
    IncurDateFrom: isoToMMDDYYYY(claim.appointment_date),
    IncurDateTo: isoToMMDDYYYY(claim.appointment_date),
    SymptomDate: isoToMMDDYYYY(claim.accident_date),
    TreatmentCountry: treatmentCountry,
    ProviderCode: null,
    ProviderName: medical.hospital_or_clinic_name ?? null,
    InvoiceID: 'NIL',
    BenefitType: benefit?.benefitType ?? null,
    BenefitHead: benefit?.benefitHead ?? null,
    DiagnosisCode: diagnosis?.diagCode ?? null,
    DiagnosisCodeDesc: '',
    DiagnosisDescription: medical.detail_of_illness_injury ?? null,
    PresentedCurrency: 'MMK',
    PresentedAmt: subtotal ?? null,
    ExchangeRate: 1,
    PaymentCurrency: 'MMK',
    PaymentExchangeRate: 1,
    PaymentMethod: paymentMethod,
    BankName: member.BANK_NAME ?? null,
    BankAcctNo: member.CL_PAY_ACCT_NO ?? null,
    BankAcctName: member.CL_PAY_ACCT_NAME ?? null,
    PayeeEmail: claimant.email_address ?? null,
    ContactNumber: claimant.phone_number ?? null,
    ReviseClaimReasonCode: '',
  }));

  return {
    MemberRefNo: member.MBR_REF_NO ?? null,
    TpaCaseNumber: claim.insurer_case_number ?? null,
    TpaClaimNumber: extractedFields.policy?.issue_no ?? null,
    ProvPortalCaseNumber: '',
    isValidation: 'N',
    isCSR: 'N',
    Items: items,
  };
}

module.exports = { buildPayload };
