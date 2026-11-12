const { isLowConfidence } = require('../assessment-summary/summary');

// Switch "hold the missing-documents email when the AI is unsure" (settings.holdUnsureMissingDocsEmail,
// 2026-09-29): which of a failed document check's findings the AI wasn't sure about. When there are any,
// the customer isn't emailed until a person has looked (send the request, or override the check).
//
// Unsure = a failed check that is about reading a document (a medical record or voucher it couldn't read
// clearly), a date mismatch, or one the AI judged at or below the AI confidence threshold (System settings). A plainly missing
// item, found with confidence or by a plain rule (e.g. no bank details at all), is not unsure: it goes to
// the customer as before.
//
// Date mismatches (2026-10-01): a follow-up pharmacy/lab voucher is often dated days after the visit, and a
// handwritten 7 is often read as 1 — a person decides before the customer is asked for a corrected invoice.
// Two decimals, as a person reads it (0.9485436893203884 → 0.95; 0.3 stays 0.3).
const shown = (confidence) => Number(Number(confidence).toFixed(2)); // a stored string ("0.4") too

const ALWAYS_UNSURE = new Set(['INCOMPLETE_MEDICAL_REPORT', 'UNCLEAR_VOUCHER', 'TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT']);
// Held for a person even with the switch off (owner 2026-11-12, UAT AYA-CL-26034500): an amount mismatch or a refund
// slip — a person revises each line amount, overrides the check or asks the customer. Never a claim revise or a
// customer email on its own.
const ALWAYS_HOLD = new Set(['VOUCHER_AMOUNT_MISMATCH']);
// Only the amount check failed (owner 2026-11-12): an API case goes on to claim preparation, which stops for a person
// before the claim revise (api-claim-preparation) — the amounts and the preparation are decided on one page.
// The findings that failed the check are its details (one per issue); information lines (vitamins) do not count. A
// reviewer's open request line is a finding too.
const amountOnly = (result) => {
  const codes = (result?.details || []).map((detail) => detail.code);
  const request = (result?.checklist || []).some((item) => item.code === 'PERSON_REQUEST' && item.passed === false);
  return result?.passed === false && !request && codes.length > 0 && codes.length === (result.issues || []).length
    && codes.every((code) => ALWAYS_HOLD.has(code));
};

// switchOn: settings.holdUnsureMissingDocsEmail. Off: only the ALWAYS_HOLD findings.
function unsureDocumentPoints(documentCheckResult, switchOn = true) {
  return (documentCheckResult?.checklist || [])
    .filter((item) => item.passed === false
      && (ALWAYS_HOLD.has(item.code) || (switchOn && (ALWAYS_UNSURE.has(item.code) || isLowConfidence(item.confidence)))))
    .map((item) => `${item.label || item.code}${item.confidence != null ? ` (AI confidence ${shown(item.confidence)})` : ' (could not read clearly)'}`);
}

// Switch "documents the AI passed but wasn't sure about: a person confirms first" (settings.holdUnsureDocumentPass,
// SYSTEM_4 E4-09): the passed checklist items scored at or below the threshold — by the AI, or (E4-08) by a rule check
// that relied on a value the AI read unsurely (bank, amounts, dates, claim form: checklist.js CHECK_FIELDS), a format
// check a value failed (VALUE_FORMAT, scores 0) or an unsure value no other check reports (FIELDS_READ).
function unsurePassedPoints(documentCheckResult) {
  return (documentCheckResult?.checklist || [])
    .filter((item) => item.passed === true && isLowConfidence(item.confidence))
    .map((item) => {
      if (item.code === 'VALUE_FORMAT') return `Values read: ${item.note}`;
      if (item.code === 'DOCUMENT_DATES') return `Medical documents without a date: ${item.note}`;
      if (item.code === 'FIELDS_READ') {
        const unsure = item.fields.filter((f) => !f.reportedBy && isLowConfidence(f.confidence)).map((f) => `${f.label} (AI confidence ${shown(f.confidence)})`);
        return `Values read with low confidence: ${unsure.join('; ')}`;
      }
      return `${item.label || item.code} (AI confidence ${shown(item.confidence)})`;
    });
}

module.exports = { unsureDocumentPoints, unsurePassedPoints, amountOnly };
