const { CheckSwitch } = require('../../db/models');
const { CHECKS } = require('./catalog');
const { ISSUES, issueForFlag } = require('../document-checking/checklist');

// AI checklist switches (SYSTEM_5 phase B, docs/imp/CR/SYSTEM_5/PRD/SYSTEM_5_PRD.md 4.4–4.5): a super admin switches a
// check off or on, with a reason. ulink_check_switches is append-only: the latest row for a code is its state, no row =
// on. A check that is off is skipped (an AI comparison is not even asked), shows "Turned off" on the case — never a pass —
// and keeps the claim from STP when it could stop a case (Q2). Both flows (Q3).

// Only checks that can stop a case or warn, and run in the code, can be switched; never a locked one (Q1). The
// information lines are always shown (Q7); the checks off in the code stay off (Q6).
const switchable = (check) => Boolean(check) && !check.locked && ['stops', 'warning'].includes(check.effect);

// code → its latest row ({ code, enabled, reason, changedBy, createdAt }).
async function switchStates() {
  const rows = await CheckSwitch.findAll({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  return new Map(rows.map((row) => [row.code, row.toJSON ? row.toJSON() : row]));
}

// code → the row that switched it off, for the checks that are off now.
async function switchedOff() {
  const states = await switchStates();
  return new Map([...states].filter(([code, row]) => row.enabled === false && switchable(CHECKS.find((c) => c.code === code))));
}

// Switches a check; returns the new row, or { error }.
async function setSwitch(code, enabled, reason, changedBy) {
  const check = CHECKS.find((c) => c.code === code);
  if (!check) return { error: `No check ${code}.` };
  if (!switchable(check)) return { error: check.locked ? `${check.question} is locked on: it protects the payment.` : `${check.question} cannot be switched.` };
  if (typeof enabled !== 'boolean') return { error: 'Say whether the check is on or off.' };
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3) return { error: 'Add a reason for the change.' };
  const current = (await switchStates()).get(code);
  if ((current?.enabled ?? true) === enabled) return { error: `The check is already ${enabled ? 'on' : 'off'}.` };
  return CheckSwitch.create({ code, enabled, reason: text, changedBy });
}

const offNote = (row) => `Turned off by ${row.changedBy} on ${new Date(row.createdAt).toISOString().slice(0, 10)}: ${row.reason}`;

/**
 * Pure: a document check result ({ issues, details, flags, checklist, passed }) with the switched-off checks taken out —
 * their issues, details and flags go, their checklist lines show turnedOff with who, when and why (passed null, never a
 * pass), and passed is worked out again. off: switchedOff()'s map.
 */
function withSwitchedOff(result, off) {
  if (!off?.size) return result;
  // A check's issue texts: its fixed text, its details', and its flags' (a required field's text is per field).
  const offIssues = new Set([
    ...[...off.keys()].map((code) => ISSUES[code]).filter(Boolean),
    ...(result.details || []).filter((d) => off.has(d.code)).map((d) => d.issue),
    ...(result.flags || []).filter((f) => off.has(f.code)).map((f) => issueForFlag(f)).filter(Boolean),
  ]);
  const issues = (result.issues || []).filter((issue) => !offIssues.has(issue));
  return {
    ...result,
    issues,
    details: (result.details || []).filter((d) => !off.has(d.code) && !offIssues.has(d.issue)),
    flags: (result.flags || []).filter((f) => !off.has(f.code)),
    checklist: (result.checklist || []).map((line) => (off.has(line.code)
      ? { ...line, passed: null, confidence: null, turnedOff: true, note: offNote(off.get(line.code)) }
      : line)),
    passed: issues.length === 0,
  };
}

// The switched-off checks that could stop a case: the claim never goes STP while one is off (Q2).
const offStopping = (off) => [...off.keys()].filter((code) => CHECKS.find((c) => c.code === code)?.effect === 'stops');

// The checks that could stop a case and were turned off when THIS case was checked (its document checklist lines and
// its member check's turnedOff list) — what claim preparation's STP rule reads, so a switch changed later never lets a
// case that skipped a check go STP, nor blocks one that was fully checked.
function caseChecksOff(memberVerifyResult, documentCheckResult) {
  const codes = [
    ...(memberVerifyResult?.turnedOff || []).map((t) => t.code),
    ...(documentCheckResult?.checklist || []).filter((l) => l.turnedOff).map((l) => l.code),
  ];
  return [...new Set(codes)].filter((code) => CHECKS.find((c) => c.code === code)?.effect === 'stops');
}

module.exports = { switchable, switchStates, switchedOff, setSwitch, withSwitchedOff, offNote, offStopping, caseChecksOff };
