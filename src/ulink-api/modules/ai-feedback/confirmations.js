const { FIELD_LABELS, valueAt } = require('../document-checking/checklist');

// "✓ Right" on the review page (SYSTEM_4 E5b, ulink_ai_feedback kind 'confirm'): a person checked a value or a check's
// result against the document and the AI was right. The document check counts it the next time it runs (owner,
// 2026-10-21, AYA-CL-26043766): an account number found by text search at 60%, confirmed, held the case at
// API_DOCUMENTS_UNSURE again after a recheck. A confirmation counts only while the value or the result is exactly what
// the person confirmed; it only raises confidence — it never passes a failed check or removes an issue. Nothing is
// written back to the reading: applied each time the check runs.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byWhom = (row) => `Confirmed by ${row.createdBy} against the document`;

/** The reading with each confirmed, unchanged value (field_evidence) at confidence 1. rows: AiFeedback confirm rows. */
function withConfirmedValues(fields, rows = []) {
  const confirmed = rows.filter((r) => r.kind === 'confirm' && FIELD_LABELS[r.item] && same(valueAt(fields, r.item), r.correctedValue));
  if (!confirmed.length) return fields;
  const evidence = Array.isArray(fields.field_evidence) ? fields.field_evidence : [];
  const items = new Set(confirmed.map((r) => r.item));
  const kept = evidence.filter((e) => !items.has(e.field));
  const added = confirmed.map((r) => ({
    field: r.item,
    confidence: 1,
    reason: byWhom(r),
    page: evidence.find((e) => e.field === r.item)?.page ?? r.page ?? null,
  }));
  return { ...fields, field_evidence: [...kept, ...added] };
}

/** The check result with each confirmed, unchanged PASSED check line at confidence 1 (a failed line is left alone). */
function withConfirmedChecks(result, rows = []) {
  const confirmed = rows.filter((r) => r.kind === 'confirm' && r.correctedValue === true);
  if (!confirmed.length || !result?.checklist) return result;
  return {
    ...result,
    checklist: result.checklist.map((line) => {
      const row = line.passed === true && confirmed.find((r) => r.item === line.code);
      return row ? { ...line, confidence: 1, note: [line.note ?? line.reason, `${byWhom(row)}.`].filter(Boolean).join(' ') } : line;
    }),
  };
}

module.exports = { withConfirmedValues, withConfirmedChecks };
