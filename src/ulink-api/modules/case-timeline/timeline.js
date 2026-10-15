// Single case timeline (SYSTEM_4 E4-24, F1): who changed what and why, in one dated list — for the case page, audits
// and disputes. Built from what is already stored; pure (no DB access): the controller loads the rows.
//
// Sources (no entry twice):
//   case history (ulink_case_events) — status moves, overrides, corrections, claims, uploads, IAS steps, emails sent;
//   AI calls (ulink_llm_calls) — grouped per job and run (a page-reading job makes one call per page); no raw answers;
//   "✓ Right" confirmations and trusted marks (ulink_ai_feedback) — the two kinds with no case-history entry.
// Kinds: people, ai, email, ias, system — the console's filter.

const { CASE_STATUSES } = require('../case-status/catalog');

// Jobs whose case-history entries are an IAS / IAS-console call; the email senders; the rest is the system's own work.
const IAS_BLOCKS = new Set([
  'ias-claim-creation', 'ias-claim-stp', 'console-upload', 'console-barcode', 'api-claim-intake', 'api-claim-revision',
  'api-claim-stp', 'api-material-download', 'api-console-watch',
]);
const EMAIL_BLOCKS = new Set(['email-sender', 'api-email-sender', 'email-intake', 'api-reply-intake']);
const PEOPLE_BLOCKS = new Set(['case-review', 'dev-reset']);
// A person's action, whichever job wrote it (e.g. the email flow logs "release the held email" under document-checking).
const PEOPLE_REASONS = new Set([
  'MANUAL_OVERRIDE', 'MANUAL_CORRECTION', 'MANUAL_RESET', 'MISSING_DOCUMENTS_RELEASED', 'DOCUMENTS_UPLOADED',
  'CASE_CLAIMED', 'CASE_RELEASED', 'CASE_TAKEN_OVER',
]);

// AI calls of one job closer than this belong to one run (one entry).
const AI_RUN_GAP_MS = 10 * 60 * 1000;

// A status's label; a code that is not a case status (an email event, e.g. API_EMAIL_SENT) in plain words.
const words = (code) => code.replace(/^API_/, '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const label = (code) => (code ? CASE_STATUSES[code]?.label ?? words(code) : null);

function kindOfEvent(e) {
  if (PEOPLE_REASONS.has(e.reasonCode) || PEOPLE_BLOCKS.has(e.blockName)) return 'people';
  if (EMAIL_BLOCKS.has(e.blockName)) return 'email';
  if (IAS_BLOCKS.has(e.blockName)) return 'ias';
  return 'system';
}

function eventEntry(e) {
  const moved = e.prevStatus && e.prevStatus !== e.newStatus;
  return {
    at: e.createdAt,
    kind: kindOfEvent(e),
    source: e.blockName,
    what: moved ? `${label(e.prevStatus)} → ${label(e.newStatus)}` : label(e.newStatus),
    why: e.message || null,
  };
}

// One entry per job run: "11 AI calls, all answered, 97 s". A run ends when a case-history entry comes between two of
// its calls (the job finished; a reset and re-read is a new run) or after AI_RUN_GAP_MS without a call.
function aiEntries(calls, eventTimes = []) {
  const sorted = [...calls].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const eventBetween = (from, to) => eventTimes.some((t) => t > new Date(from).getTime() && t < new Date(to).getTime());
  const runs = [];
  for (const call of sorted) {
    const run = runs.findLast((r) => r.job === (call.job || null));
    if (run && new Date(call.createdAt) - new Date(run.last) <= AI_RUN_GAP_MS && !eventBetween(run.last, call.createdAt)) {
      run.calls.push(call);
      run.last = call.createdAt;
    } else {
      runs.push({ job: call.job || null, first: call.createdAt, last: call.createdAt, calls: [call] });
    }
  }
  return runs.map((r) => {
    const failed = r.calls.filter((c) => c.status !== 'ok');
    const seconds = Math.round(r.calls.reduce((s, c) => s + (c.durationMs || 0), 0) / 1000);
    const prompts = [...new Set(r.calls.map((c) => c.promptName).filter(Boolean))];
    return {
      at: r.first,
      kind: 'ai',
      source: r.job || 'ai',
      what: `${r.calls.length} AI call${r.calls.length > 1 ? 's' : ''}${failed.length ? ` — ${failed.length} not answered (${[...new Set(failed.map((c) => c.status))].join(', ')})` : ', all answered'}, ${seconds} s`,
      why: prompts.length ? `Prompts: ${prompts.join(', ')}` : null,
    };
  });
}

const shown = (v) => (v === true ? 'passed' : v === false ? 'failed' : v == null ? '—' : `"${v}"`);

function feedbackEntries(rows) {
  const entries = [];
  for (const f of rows) {
    if (f.kind === 'confirm') {
      entries.push({ at: f.createdAt, kind: 'people', source: 'review-workspace', what: `${f.label}: AI ${shown(f.aiValue)} confirmed right`, why: `${f.createdBy} — ${f.reason}` });
    }
    if (f.trusted && f.trustedAt) {
      entries.push({ at: f.trustedAt, kind: 'people', source: 'case-review', what: `Correction of ${f.label} marked trusted`, why: `${f.trustedBy} agreed with ${f.createdBy}'s correction` });
    }
  }
  return entries;
}

/**
 * Newest first. Each entry: { at, kind: people|ai|email|ias|system, source, what, why }. events / llmCalls / feedback
 * oldest first (the controller orders them); entries with the same time keep that order, reversed.
 */
function buildTimeline({ events = [], llmCalls = [], feedback = [] }) {
  const eventTimes = events.map((e) => new Date(e.createdAt).getTime());
  return [...events.map(eventEntry), ...aiEntries(llmCalls, eventTimes), ...feedbackEntries(feedback)]
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => new Date(b.entry.at) - new Date(a.entry.at) || b.i - a.i)
    .map(({ entry }) => entry);
}

module.exports = { buildTimeline, AI_RUN_GAP_MS };
