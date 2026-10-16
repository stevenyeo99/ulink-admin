// Feedback report (SYSTEM_4 E4-14, F2): every time a person corrected, confirmed or overrode the AI, one row each —
// case, item, what the AI found and how sure it was, what the person decided, their comment, who, when.
// Sources: ulink_ai_feedback (corrections and "✓ Right") and the MANUAL_OVERRIDE case-history entries. Read-only.
// The console filters by item / type and exports CSV from these rows.

const { Op } = require('sequelize');
const { Case, CaseEvent, AiFeedback } = require('../../db/models');
const { OVERRIDE_AREAS, OVERRIDE_FINDINGS } = require('../case-override/override');
const { WRONG_STEP_LABELS } = require('./corrections');

// ponytail: newest 5000 rows per source; page or stream when a date range really holds more.
const ROW_LIMIT = 5000;
const AREA_LABELS = { member: 'Member check', documents: 'Document check' };

const shown = (v) => (v === true ? 'passed' : v === false ? 'failed' : v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function feedbackRow(f) {
  const confirm = f.kind === 'confirm';
  return {
    at: f.createdAt,
    caseId: f.caseId,
    type: confirm ? 'Confirmed right' : 'Correction',
    item: f.label,
    aiFinding: shown(f.aiValue),
    aiConfidence: f.aiConfidence ?? null,
    decision: confirm ? 'AI was right' : `Changed to ${shown(f.correctedValue)}${f.wrongStep ? ` (${WRONG_STEP_LABELS[f.wrongStep]})` : ''}`,
    comment: f.reason,
    by: f.createdBy,
    trusted: confirm ? null : Boolean(f.trusted),
  };
}

// The override entry's text is written by casesController.overrideCase:
// "Overridden by <operator> — <finding>: <reason> (waived: <review points>)". The finding is matched against the known
// texts, because some of them contain ": " themselves.
function overrideRow(e) {
  const text = String(e.message || '');
  const [, operator = '', rest = text] = text.match(/^Overridden by (.+?) — (.*)$/s) || [];
  // The waived list is always last; a reason may itself hold " (waived: ".
  const cut = rest.endsWith(')') ? rest.lastIndexOf(' (waived: ') : -1;
  const body = cut >= 0 ? rest.slice(0, cut) : rest;
  const waived = cut >= 0 ? rest.slice(cut + ' (waived: '.length, -1) : null;
  const finding = Object.values(OVERRIDE_FINDINGS).find((f) => body.startsWith(`${f}: `));
  return {
    at: e.createdAt,
    caseId: e.caseId,
    type: 'Override',
    item: AREA_LABELS[OVERRIDE_AREAS[e.prevStatus]] ?? e.prevStatus,
    aiFinding: waived ?? e.prevStatus,
    aiConfidence: null,
    decision: finding ?? 'Overridden',
    comment: finding ? body.slice(finding.length + 2) : body,
    by: operator,
    trusted: null,
  };
}

/**
 * { rows, truncated }: rows newest first, each with the case's claim number, TPA case number and source.
 *   from / to: Date or null — created on or after from, before to.
 * When a source hits ROW_LIMIT, rows older than its oldest row are dropped too (so no gap in one source only) and
 * truncated is true.
 */
async function feedbackReport({ from = null, to = null } = {}) {
  const createdAt = {};
  if (from) createdAt[Op.gte] = from;
  if (to) createdAt[Op.lt] = to;
  const when = from || to ? { createdAt } : {};

  const [feedback, overrides] = await Promise.all([
    AiFeedback.findAll({ where: when, order: [['createdAt', 'DESC']], limit: ROW_LIMIT }),
    CaseEvent.findAll({
      where: { ...when, reasonCode: 'MANUAL_OVERRIDE', prevStatus: Object.keys(OVERRIDE_AREAS) },
      order: [['createdAt', 'DESC']],
      limit: ROW_LIMIT,
    }),
  ]);
  const cutoff = Math.max(...[feedback, overrides].map((list) => (list.length >= ROW_LIMIT ? new Date(list.at(-1).createdAt).getTime() : -Infinity)));
  const rows = [...feedback.map(feedbackRow), ...overrides.map(overrideRow)]
    .filter((r) => new Date(r.at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const cases = await Case.findAll({
    where: { id: [...new Set(rows.map((r) => r.caseId))] },
    attributes: ['id', 'claimNo', 'tpaCaseNumber', 'source'],
  });
  const byId = new Map(cases.map((c) => [c.id, c]));
  return {
    truncated: cutoff > -Infinity,
    rows: rows.map((r) => {
      const c = byId.get(r.caseId);
      return { ...r, claimNo: c?.claimNo ?? null, tpaCaseNumber: c?.tpaCaseNumber ?? null, source: c?.source ?? null };
    }),
  };
}

module.exports = { feedbackReport, feedbackRow, overrideRow, ROW_LIMIT };
