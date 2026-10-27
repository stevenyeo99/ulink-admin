const { Op, literal } = require('sequelize');
const { CASE_STATUSES } = require('../case-status/catalog');

// The review lane's marker (docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md 4.1): set when a person decided a case,
// cleared when the case leaves the lane — it stops for a person (needs_review, failed), waits for the customer, ends
// (done), or waits for an outside system. While set, only the review lane processes the case (runApiJob lane).

// In progress, but waiting for an outside system: the existing pipeline (lane 1) waits for it as before. Older cases
// only: API_DOCUMENTS_UPLOADED waits for the IAS console (console watch).
const OUTSIDE_WAITS = new Set(['API_CONSOLE_BARCODE_PENDING', 'API_AWAITING_CSR', 'API_DOCUMENTS_UPLOADED', 'CONSOLE_BARCODE_PENDING']);

/** True when a case at this status leaves the review lane (the marker is cleared). */
const leavesLane = (status) => CASE_STATUSES[status]?.group !== 'in_progress' || OUTSIDE_WAITS.has(status);

/** The fields that mark a case for its flow's review lane. */
const markFor = (caseRecord, by) => (['API', 'EMAIL'].includes(caseRecord.source) ? { reviewPendingAt: new Date(), reviewPendingBy: by } : {});

/** The where fragment of a job for its lane: 'new' (the existing pipeline) unmarked cases, 'review' marked ones. */
const laneWhere = (lane = 'new') => ({ reviewPendingAt: lane === 'review' ? { [Op.ne]: null } : null });

const BEING_CHECKED = 'This case is being checked again after a decision. Wait until it finishes.';

/** A job's order for its lane: the review lane takes the cases a person asked for first (only real case ids). */
function laneOrder(lane, first, order) {
  const ids = lane === 'review' ? (first || []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  return ids.length ? [[literal(`"Case"."id" IN (${ids.map((id) => `'${id}'`).join(',')})`), 'DESC'], ...order] : order;
}

module.exports = { OUTSIDE_WAITS, leavesLane, markFor, laneWhere, laneOrder, BEING_CHECKED };
