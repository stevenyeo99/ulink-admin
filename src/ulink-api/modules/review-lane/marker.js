const { CASE_STATUSES } = require('../case-status/catalog');

// The review lane's marker (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md 4.1): set when a person decided an API case,
// cleared when the case leaves the lane — it stops for a person (needs_review, failed), waits for the customer, ends
// (done), or waits for an outside system. While set, only the review lane processes the case (runApiJob lane).

// In progress, but waiting for an outside system: the existing pipeline (lane 1) waits for it as before. Older cases
// only: API_DOCUMENTS_UPLOADED waits for the IAS console (console watch).
const OUTSIDE_WAITS = new Set(['API_CONSOLE_BARCODE_PENDING', 'API_AWAITING_CSR', 'API_DOCUMENTS_UPLOADED']);

/** True when a case at this status leaves the review lane (the marker is cleared). */
const leavesLane = (status) => CASE_STATUSES[status]?.group !== 'in_progress' || OUTSIDE_WAITS.has(status);

/** The fields that mark a case for the review lane (only API cases have a review lane so far). */
const markFor = (caseRecord, by) => (caseRecord.source === 'API' ? { reviewPendingAt: new Date(), reviewPendingBy: by } : {});

const BEING_CHECKED = 'This case is being checked again after a decision. Wait until it finishes.';

module.exports = { OUTSIDE_WAITS, leavesLane, markFor, BEING_CHECKED };
