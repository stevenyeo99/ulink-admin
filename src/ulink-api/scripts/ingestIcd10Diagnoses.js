'use strict';

// One-off data load, not an HTTP job/cron endpoint — run manually:
//   node scripts/ingestIcd10Diagnoses.js [path-to-xlsx]
//
// Reads docs/imp/day1/IAS_RAG/DIAG_CLASS_ICD10_2012_STAGING.xlsx (IAS's own RT_DIAGNOSIS
// export, ~39,793 rows: DIAG_OID, DIAG_CODE, DIAG_DESC), embeds each DIAG_DESC via
// modules/icd10/embeddingClient.js, and upserts into ulink_icd10_diagnoses
// (db/migrations/20260823160000-create-icd10-diagnoses.js).
//
// Resumable: rows whose diag_oid is already in the table are skipped before any embedding
// call is made, so an interrupted run (Ctrl+C, a crash) can just be re-run and only
// processes what's left. The upsert (ON CONFLICT) is a safety net on top of that, not the
// primary resumability mechanism.

const path = require('path');
const ExcelJS = require('exceljs');
const { sequelize } = require('../db/models');
const { embed, TASK_PREFIX } = require('../modules/icd10/embeddingClient');

const DEFAULT_XLSX_PATH = path.join(__dirname, '../../../docs/imp/day1/IAS_RAG/DIAG_CLASS_ICD10_2012_STAGING.xlsx');
const SHEET_NAME = 'Export Worksheet';
const CONCURRENCY = 8;
const PROGRESS_EVERY = 500;

async function readDiagnosisRows(xlsxPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in ${xlsxPath}`);

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const [, diagOid, diagCode, diagDesc] = row.values; // row.values is 1-indexed, [0] unused
    if (diagOid == null || diagCode == null || diagDesc == null) return;
    rows.push({ diagOid: Math.round(Number(diagOid)), diagCode: String(diagCode), diagDesc: String(diagDesc) });
  });
  return rows;
}

async function fetchExistingDiagOids() {
  const rows = await sequelize.query('select diag_oid from ulink_icd10_diagnoses', {
    type: sequelize.QueryTypes.SELECT,
  });
  return new Set(rows.map((row) => row.diag_oid));
}

async function upsertDiagnosis({ diagOid, diagCode, diagDesc }) {
  const embedding = await embed(diagDesc, { taskPrefix: TASK_PREFIX.DOCUMENT });
  const vectorLiteral = `[${embedding.join(',')}]`;

  await sequelize.query(
    `insert into ulink_icd10_diagnoses (diag_oid, diag_code, diag_desc, embedding, updated_at)
     values (:diagOid, :diagCode, :diagDesc, :vec::vector, now())
     on conflict (diag_oid) do update set
       diag_code = excluded.diag_code,
       diag_desc = excluded.diag_desc,
       embedding = excluded.embedding,
       updated_at = now()`,
    { replacements: { diagOid, diagCode, diagDesc, vec: vectorLiteral } }
  );
}

/** Small inline worker pool — no new dependency for something this simple. */
async function runWithConcurrency(items, worker, concurrency) {
  let index = 0;
  let done = 0;
  let failed = 0;

  async function runOne() {
    while (index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (error) {
        failed += 1;
        console.error(`Failed diag_oid=${item.diagOid}:`, error.message);
      }
      done += 1;
      if (done % PROGRESS_EVERY === 0 || done === items.length) {
        console.log(`Processed ${done}/${items.length} (${failed} failed)`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
  return { done, failed };
}

async function main() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX_PATH;
  console.log(`Reading ${xlsxPath}...`);
  const allRows = await readDiagnosisRows(xlsxPath);
  console.log(`Parsed ${allRows.length} rows.`);

  const existing = await fetchExistingDiagOids();
  const pending = allRows.filter((row) => !existing.has(row.diagOid));
  console.log(`${existing.size} already embedded, ${pending.length} remaining.`);

  if (pending.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const { done, failed } = await runWithConcurrency(pending, upsertDiagnosis, CONCURRENCY);
  console.log(`Done. Processed ${done}, ${failed} failed (re-run this script to retry those).`);
}

main()
  .catch((error) => {
    console.error('Ingestion failed:', error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
