const { CASE_STATUSES } = require('../case-status/catalog');
const { OVERRIDE_AREAS } = require('../case-override/override');
const { buildAssessmentSummary } = require('../assessment-summary/summary');

// The baseline (SYSTEM_4 D3): how the AI's checks come out today, from the results already stored on the cases — the
// "before" numbers to compare with after a prompt change (E3) or once reviewer corrections exist (E4-15). Pure: the
// script scripts/baselineReport.js reads the database (read-only) and writes the report. No AI calls.
//
// cases: case fields (an API case's filled from its job steps, as the case page does), with `events` (its CaseEvents).

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const top = (map, n = 8) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);

function baselineFrom(cases, threshold) {
  const bySource = new Map();
  const byGroup = new Map();
  const items = new Map(); // checklist code → { label, evaluated, failed, scores: [] }
  const member = new Map();
  const reviewReasons = new Map();
  const stpReasons = new Map();
  const overridesByArea = new Map();
  let withOpenPoints = 0;
  let summarized = 0;
  let prepared = 0;
  let stp = 0;
  const diagnosis = { picked: 0, defaulted: 0, scores: [] };
  const benefitScores = [];

  for (const c of cases) {
    bump(bySource, c.source || 'EMAIL');
    bump(byGroup, CASE_STATUSES[c.currentStatus]?.group || 'unknown');

    for (const item of c.documentCheckResult?.checklist || []) {
      if (item.passed === null || item.passed === undefined) continue;
      const key = item.code === 'MISSING_MANDATORY_FIELD' ? 'MISSING_MANDATORY_FIELD' : item.code;
      const entry = items.get(key) || { label: key === 'MISSING_MANDATORY_FIELD' ? 'Mandatory fields (each)' : item.label || key, evaluated: 0, failed: 0, scores: [] };
      entry.evaluated += 1;
      if (item.passed === false) entry.failed += 1;
      if (typeof item.confidence === 'number') entry.scores.push(item.confidence);
      items.set(key, entry);
    }

    if (c.memberVerifyResult) bump(member, c.memberVerifyResult.reasonCode || c.memberVerifyResult.outcome || 'unknown');

    if (c.claimPrepMeta) {
      prepared += 1;
      if (c.isStp) stp += 1;
      for (const reason of c.claimPrepMeta.stp?.reasons || []) bump(stpReasons, reason.replace(/\d[\d,.]*/g, 'N').slice(0, 90));
      const d = c.claimPrepMeta.diagnosis;
      if (d) {
        diagnosis.picked += 1;
        if (d.defaulted) diagnosis.defaulted += 1;
        if (typeof d.confidence === 'number') diagnosis.scores.push(d.confidence);
      }
      for (const line of c.claimPrepMeta.lines || []) if (typeof line.confidence === 'number') benefitScores.push(line.confidence);
    }

    if (c.documentCheckResult || c.memberVerifyResult) {
      summarized += 1;
      const open = buildAssessmentSummary(c).reviewPoints.filter((p) => !p.overridden);
      if (open.length) withOpenPoints += 1;
      for (const p of open) bump(reviewReasons, `${p.decision} — ${p.reason}`);
    }

    for (const e of c.events || []) {
      if (e.reasonCode === 'MANUAL_OVERRIDE' && OVERRIDE_AREAS[e.prevStatus]) bump(overridesByArea, OVERRIDE_AREAS[e.prevStatus]);
    }
  }

  const checklist = [...items.entries()].map(([code, e]) => ({
    code,
    label: e.label,
    evaluated: e.evaluated,
    failedShare: e.evaluated ? e.failed / e.evaluated : null,
    scored: e.scores.length,
    avgConfidence: avg(e.scores),
    unsureShare: e.scores.length ? e.scores.filter((s) => s <= threshold).length / e.scores.length : null,
  })).sort((a, b) => b.evaluated - a.evaluated);

  return {
    threshold,
    cases: cases.length,
    bySource: Object.fromEntries(bySource),
    byGroup: Object.fromEntries(byGroup),
    checklist,
    member: top(member, 20),
    review: { summarized, withOpenPoints, reasons: top(reviewReasons) },
    stp: { prepared, stp, reasons: top(stpReasons) },
    diagnosis: { picked: diagnosis.picked, defaulted: diagnosis.defaulted, avgConfidence: avg(diagnosis.scores), scored: diagnosis.scores.length },
    benefit: { scored: benefitScores.length, avgConfidence: avg(benefitScores), unsureShare: benefitScores.length ? benefitScores.filter((s) => s <= threshold).length / benefitScores.length : null },
    overridesByArea: Object.fromEntries(overridesByArea),
  };
}

function baselineMarkdown(b, { date, database }) {
  const rows = (list) => (list.length ? list.map((r) => `| ${r.join(' | ')} |`).join('\n') : '| None. | |');
  return `# AI baseline — ${date}

The "before" numbers for SYSTEM_4 (D3): how the AI's checks come out on the cases already processed, from what is
stored on them (database: ${database}). Read-only; no AI was called. Compare with a later run of
\`npm run report:baseline\` after a prompt change (E3) — per prompt version, see the console's *AI performance* page.
"Unsure" = a confidence at or below the AI confidence threshold, **${fmt(b.threshold)}**.

## Cases
${b.cases} cases — ${Object.entries(b.bySource).map(([s, n]) => `${s} ${n}`).join(', ')}.

| Group | Cases | Share |
|---|---|---|
${rows(Object.entries(b.byGroup).sort((a, c) => c[1] - a[1]).map(([g, n]) => [g, n, pct(n, b.cases)]))}

## Document checklist (per item)
| Check | Evaluated | Failed | With a confidence | Avg confidence | Unsure |
|---|---|---|---|---|---|
${rows(b.checklist.map((c) => [c.label, c.evaluated, fmt(c.failedShare), c.scored, fmt(c.avgConfidence), fmt(c.unsureShare)]))}

## Review points
${b.review.withOpenPoints} of ${b.review.summarized} checked cases (${pct(b.review.withOpenPoints, b.review.summarized)}) have at least one open review point.

| Review point | Cases |
|---|---|
${rows(b.review.reasons)}

## Member check
| Result | Cases |
|---|---|
${rows(b.member)}

## Diagnosis and benefit picks
- Diagnosis picked: ${b.diagnosis.picked}; fell back to R69 (no confident pick): ${b.diagnosis.defaulted} (${pct(b.diagnosis.defaulted, b.diagnosis.picked)}); average confidence ${fmt(b.diagnosis.avgConfidence)}.
- Benefit picks with a confidence: ${b.benefit.scored}; average ${fmt(b.benefit.avgConfidence)}; unsure ${fmt(b.benefit.unsureShare)}.

## STP
${b.stp.stp} of ${b.stp.prepared} prepared claims went STP (${pct(b.stp.stp, b.stp.prepared)}). Most common reasons for no STP:

| Reason | Claims |
|---|---|
${rows(b.stp.reasons)}

## Overrides by people
${Object.keys(b.overridesByArea).length ? Object.entries(b.overridesByArea).map(([a, n]) => `- ${a}: ${n}`).join('\n') : 'None yet.'}
`;
}

module.exports = { baselineFrom, baselineMarkdown };
