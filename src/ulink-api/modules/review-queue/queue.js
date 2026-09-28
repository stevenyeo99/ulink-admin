// Review Queue: which cases a person should look at, and why
// (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, step 3).
//
// Built from two things the system already knows: the case's status group (status catalog) and the
// review points of its AI assessment (assessment-summary). No new state — the queue is always the
// current picture. The rule lives only in queueEntry below.

const { CASE_STATUSES } = require('../case-status/catalog');
const { buildAssessmentSummary } = require('../assessment-summary/summary');

// IAS said no — a person has to read the reason and fix the claim.
const SYSTEM_ISSUE_STATUSES = new Set(['CLAIM_SUBMIT_FAILED', 'API_CLAIM_REVISION_FAILED']);
const SYSTEM_ISSUE = 'System issue';

// Most serious first — a case is filed under the first of its reasons found here.
const REASON_ORDER = [SYSTEM_ISSUE, 'Data mismatch', 'Rule hold', 'Unreadable', 'AI unsure', 'Missing information'];

// Points that don't by themselves need our team: the customer was already asked for missing
// information, and "STP with open review points" only restates the points under it.
const NOT_OURS = new Set(['Missing information', 'STP with open review points']);

// A status with no assessment point still says what kind of look it needs.
const STATUS_REASONS = {
  MANUAL_REVIEW: 'Unreadable',
  API_MANUAL_REVIEW: 'Unreadable',
  MEMBER_REVIEW_REQUIRED: 'Data mismatch',
  API_MEMBER_REVIEW_REQUIRED: 'Data mismatch',
};

const rank = (reason) => {
  const i = REASON_ORDER.indexOf(reason);
  return i === -1 ? REASON_ORDER.length : i;
};

/**
 * Whether a case belongs in the queue.
 *   status: Case.currentStatus; fields: the case fields the assessment reads (Case row / apiCaseView).
 * Returns null (not in the queue) or { reason, check, reasons, pointCount }.
 *
 * In the queue: status group "needs_review"; IAS rejected it; or an open case (in progress / waiting
 * on customer) with an assessment point our team should check. Not in the queue: finished cases
 * (checking those is the audit sample, a separate decision) and cases whose only point is missing
 * information the customer was already asked for.
 *
 * overrides: checks a person already overrode on this case ([{ area, at, note }],
 * modules/case-override overridesFromEvents) — their points were dealt with and don't queue it again.
 */
function queueEntry(status, fields, overrides = []) {
  const group = CASE_STATUSES[status]?.group;
  const summary = buildAssessmentSummary(fields, { overrides });
  const points = summary.reviewPoints.filter((p) => !NOT_OURS.has(p.reason) && !p.overridden);

  const reasons = new Set(points.map((p) => p.reason));
  if (SYSTEM_ISSUE_STATUSES.has(status)) reasons.add(SYSTEM_ISSUE);
  else if (group === 'needs_review') reasons.add(STATUS_REASONS[status] || 'AI unsure');
  else if (!(group === 'in_progress' || group === 'waiting_customer') || points.length === 0) return null;

  const sorted = [...reasons].sort((a, b) => rank(a) - rank(b));
  const primary = sorted[0];
  const point = points.find((p) => p.reason === primary);
  return {
    reason: primary,
    check: point
      ? `${point.decision}: ${point.check}`
      : primary === SYSTEM_ISSUE
        ? 'IAS rejected it — read the reason in the case history and fix the claim.'
        : CASE_STATUSES[status]?.description || 'Open the case to see what needs checking.',
    reasons: sorted,
    pointCount: points.length,
  };
}

module.exports = { queueEntry, REASON_ORDER };
