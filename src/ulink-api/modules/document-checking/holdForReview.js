const { LOW_CONFIDENCE } = require('../assessment-summary/summary');

// Switch "hold the missing-documents email when the AI is unsure" (settings.holdUnsureMissingDocsEmail,
// 2026-09-29): which of a failed document check's findings the AI wasn't sure about. When there are any,
// the customer isn't emailed until a person has looked (send the request, or override the check).
//
// Unsure = a failed check that is about reading a document (a medical record or voucher it couldn't read
// clearly), a date mismatch, or one the AI judged at or below the usual confidence (0.5). A plainly missing
// item, found with confidence or by a plain rule (e.g. no bank details at all), is not unsure: it goes to
// the customer as before.
//
// Date mismatches (2026-10-01): a follow-up pharmacy/lab voucher is often dated days after the visit, and a
// handwritten 7 is often read as 1 — a person decides before the customer is asked for a corrected invoice.
const ALWAYS_UNSURE = new Set(['INCOMPLETE_MEDICAL_REPORT', 'UNCLEAR_VOUCHER', 'TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT']);

function unsureDocumentPoints(documentCheckResult) {
  return (documentCheckResult?.checklist || [])
    .filter((item) => item.passed === false
      && (ALWAYS_UNSURE.has(item.code) || (item.confidence != null && item.confidence <= LOW_CONFIDENCE)))
    .map((item) => `${item.label || item.code}${item.confidence != null ? ` (AI confidence ${item.confidence})` : ' (could not read clearly)'}`);
}

module.exports = { unsureDocumentPoints };
