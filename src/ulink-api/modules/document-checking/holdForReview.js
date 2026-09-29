const { LOW_CONFIDENCE } = require('../assessment-summary/summary');

// Switch "hold the missing-documents email when the AI is unsure" (settings.holdUnsureMissingDocsEmail,
// 2026-09-29): which of a failed document check's findings the AI wasn't sure about. When there are any,
// the customer isn't emailed until a person has looked (send the request, or override the check).
//
// Unsure = a failed check that is about reading a document (a medical record or voucher it couldn't read
// clearly), or one the AI judged below the usual confidence (0.5). A plainly missing item, found with
// confidence or by a plain rule (e.g. no bank details at all), is not unsure: it goes to the customer as before.
const READING_PROBLEMS = new Set(['INCOMPLETE_MEDICAL_REPORT', 'UNCLEAR_VOUCHER']);

function unsureDocumentPoints(documentCheckResult) {
  return (documentCheckResult?.checklist || [])
    .filter((item) => item.passed === false
      && (READING_PROBLEMS.has(item.code) || (item.confidence != null && item.confidence < LOW_CONFIDENCE)))
    .map((item) => `${item.label || item.code}${item.confidence != null ? ` (AI confidence ${item.confidence})` : ' (could not read clearly)'}`);
}

module.exports = { unsureDocumentPoints };
