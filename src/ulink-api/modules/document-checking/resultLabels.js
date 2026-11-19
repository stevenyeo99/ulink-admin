// Checks whose label follows the result (UAT 17/11, owner 2026-11-19): a failed check that read "consistent" or "No
// vitamins" was read as a pass. pass: the label when the check passes, and the check's name (AI checklist page,
// reports); fail: the label when it fails. A leaf module: the checklist, the hold reason and the catalog all read it.
// A new one: one line.
const RESULT_LABELS = {
  TREATMENT_DATE_INCONSISTENT: { pass: 'Treatment date is consistent with medical record date', fail: 'Treatment date is inconsistent with medical record date' },
  INVOICE_DATE_INCONSISTENT: { pass: 'Invoice date(s) are consistent with medical record date', fail: 'Invoice date(s) are inconsistent with medical record date' },
  VITAMIN_OR_SUPPLEMENT: { pass: 'No vitamins / supplements on the vouchers', fail: 'Vitamins / supplements found on the vouchers' },
};

// The label for a result. Only a decided check (true / false) changes it: an undecided or turned-off one (null) keeps
// the name it has (stored), or the pass label (new).
const resultLabel = (code, passed, stored) => (passed === false ? RESULT_LABELS[code].fail : passed === true ? RESULT_LABELS[code].pass : stored ?? RESULT_LABELS[code].pass);

// A failed check's label that already names the problem, or null: the hold reason then needs no "Not met:".
const failLabel = (item) => (item.passed === false && RESULT_LABELS[item.code] ? RESULT_LABELS[item.code].fail : null);

module.exports = { RESULT_LABELS, resultLabel, failLabel };
