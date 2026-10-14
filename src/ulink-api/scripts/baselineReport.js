#!/usr/bin/env node
// SYSTEM_4 D3 — the AI baseline: how the AI's checks come out on the cases already processed, written as a dated
// Markdown report. Read-only (only SELECTs); no AI calls.
//
//   npm run report:baseline                       → docs/imp/CR/SYSTEM_4/baseline_<YYYYMMDD>.md
//   npm run report:baseline -- <output file.md>

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../db/models');
const { apiCaseView } = require('../modules/api-pipeline/caseView');
const { getSettings } = require('../modules/settings/settings');
const { baselineFrom, baselineMarkdown } = require('../modules/llm-calls/baseline');

async function main() {
  const settings = await getSettings(); // also sets the threshold the assessment summary uses
  const [cases, events, steps] = await Promise.all([
    Case.findAll({ raw: true }),
    CaseEvent.findAll({ where: { reasonCode: 'MANUAL_OVERRIDE' }, raw: true }),
    ApiCaseStep.findAll({ where: { status: 'DONE' }, raw: true }),
  ]);
  const eventsByCase = new Map();
  for (const e of events) eventsByCase.set(e.caseId, [...(eventsByCase.get(e.caseId) || []), e]);
  const stepsByCase = new Map();
  for (const s of steps) stepsByCase.set(s.caseId, [...(stepsByCase.get(s.caseId) || []), s]);

  // An API case's results live in its job steps — fill them in the way the case page does.
  const fields = cases.map((c) => ({
    ...c,
    ...(c.source === 'API' ? apiCaseView(stepsByCase.get(c.id) || []) : {}),
    events: eventsByCase.get(c.id) || [],
  }));

  const today = new Date().toISOString().slice(0, 10);
  const out = process.argv[2] || path.join(__dirname, '../../../docs/imp/CR/SYSTEM_4', `baseline_${today.replace(/-/g, '')}.md`);
  const database = sequelize.config.database; // the name only — no server address in a document
  fs.writeFileSync(out, baselineMarkdown(baselineFrom(fields, settings.aiConfidenceThreshold), { date: today, database }));
  console.log(`Baseline of ${cases.length} cases written to ${path.relative(process.cwd(), out)}`);
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
