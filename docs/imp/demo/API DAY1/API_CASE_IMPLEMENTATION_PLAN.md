# API Case Implementation Plan

Status: Phase 0, 1, 2 and 3 built (2026-09-24)  
Scope: `ulink-admin/src/ulink-api` + `ulink-admin/src/ulink-console`  
Date: 2026-09-24

## 1. Summary

The project gets a second workflow next to the existing email workflow.

| | Email case | API case |
|---|---|---|
| Starts from | A new email in the inbox | A claim listed by IAS `get_claim_api` (every 30 min) |
| Documents | Email attachments | Console images (via ulink-console-middleware) + reply attachments |
| IAS action | Create claim (`CL_CLAIM_API`) | Claim revision (claim already exists as `clNo`) |
| Orchestrator | `POST /api/jobs/pipeline/run` (unchanged) | `POST /api/jobs/api-pipeline/run` (new) |
| Statuses | Existing (`EMAIL_RECEIVED`, …) | New, all prefixed `API_` |

Both workflows share one inbox, one email reader (`email-intake`), one email sender (`email-sender`), the email
tables, and the business rules (OCR, member checks, document checklist, payload builder). Each workflow has its
own jobs and statuses.

## 2. How the workflow works

The design (isolation rules, statuses, job inputs/outputs, orchestrator, email routing) lives in
[`docs/imp/day1/api-case-workflow.md`](../../day1/api-case-workflow.md), the developer reference. This plan only
tracks delivery order, decisions and open questions. When a phase changes the design, update that file.

---

## Phase 0: Case source flag and isolation (foundation) — BUILT 2026-09-24

Migration `20260924100000-add-api-case-source.js`; tests `tests/caseSourceConstraint.test.js` (real DB, rolled
back) and `tests/emailJobIsolation.test.js` (every email job's case selection).

**Goal:** the database can hold API cases without any email job ever seeing them.

- Migration on `ulink_cases`:
  - `source` `VARCHAR NOT NULL DEFAULT 'EMAIL'`, check `source IN ('EMAIL','API')`
  - `tpa_case_number` `TEXT NULL`
  - `ias_api_claim` `JSONB NULL`
  - check: `(source = 'API') = (current_status LIKE 'API\_%')`
  - unique partial indexes: `(claim_no) WHERE source = 'API'`, `(tpa_case_number) WHERE source = 'API'`
- `db/models/case.js`: add the three fields.
- Cases list API (`controllers/cases/casesController.js`): optional `?source=EMAIL|API` filter.
- Tests:
  - the check constraint rejects an API case with an email status, and an email case with an `API_` status;
  - isolation: with one `API_RECEIVED` case present, each email job (`claim-recognition`, `member-verification`,
    `document-checking`, `console-upload`, `ias-claim-preparation`, `ias-claim-creation`, `ias-claim-stp`)
    selects nothing and leaves it unchanged.

**Done when:** migration runs up and down cleanly and the existing email test suite passes unchanged.

## Phase 1: `api-claim-intake` job — BUILT 2026-09-24

**Goal:** every API claim created in IAS becomes exactly one API case.

- `modules/api-claim-intake/iasClient.js`: `GET {IAS_URL}{GET_CLAIM_API}?dateFrom=&dateTo=`, same timeout and error
  handling as `modules/ias-claim-creation/iasClaimClient.js`. New env `GET_CLAIM_API=/api/get_claim_api`.
- `modules/api-claim-intake/service.js` `run()`:
  - date range defaults to **today** in Myanmar time (UTC+6:30), both bounds. **Built.**
  - for each claim: insert `source='API'`, `claimNo=clNo`, `tpaCaseNumber`, `iasApiClaim=<row>`,
    `currentStatus='API_RECEIVED'` with `ON CONFLICT DO NOTHING`, plus a `CaseEvent` for rows actually inserted.
  - `success:false`, a timeout or a non-2xx response writes nothing (retried next run).
  - a row missing `clNo` or `tpaCaseNumber` is skipped and logged; the rest still go in.
  - returns `{ fetched, inserted, skippedExisting, skippedInvalid }`.
- Test endpoint: `GET /api/dev/api-claim-intake/preview?dateFrom=&dateTo=` (real IAS call, no DB write). **Built.**
- Route: `POST /api/jobs/api-claim-intake/run` and `/release` via `createJobRouter`.
- Docs: mark section 6.1 of `api-case-workflow.md` as built.
- Tests:
  - running twice with the same IAS response inserts once;
  - an IAS failure inserts nothing;
  - an invalid row is skipped without blocking the others.

**Done when:** a real staging call creates the API cases, and a second call creates none.

## Phase 2: API orchestrator and console tabs — BUILT 2026-09-24

Migration `20260924120000-add-pipeline-to-pipeline-runs.js`. Email pipeline unchanged: same endpoints, same
steps, same lock, Email is the console's default tab. Guard test: `tests/emailJobIsolation.test.js` "pipeline step
lists". The API step list only holds jobs that exist (`api-claim-intake`, `api-material-download`);
`email-intake`/`email-sender` join in Phase 4/6.

**Goal:** the API workflow runs on its own schedule and is visible separately in the console.

- API:
  - `ulink_pipeline_runs.pipeline` column: `'EMAIL'` (default) or `'API'`.
  - `POST /api/jobs/api-pipeline/run` plus `/release`, `/runs` and `/runs/:id`, all filtered to `pipeline='API'`.
    The existing `/api/jobs/pipeline/*` endpoints return email runs only.
  - Cron entry: every 30 minutes.
- Console (`ulink-console`):
  - `PipelinePage`: **Email | API** tabs. Each tab shows its own graph (a separate step layout in `graph/`), its
    own latest run, and its own Run button.
  - `CasesPage`: **Email | API** tabs using the `?source=` filter.
  - `CaseDetailPage`: shows the source; API cases also show `claimNo` and `tpaCaseNumber`.

**Done when:** both tabs show their own runs and cases, and an API case never appears under the Email tab.

## Phase 3: `api-material-download` job — BUILT 2026-09-24

Built ahead of Phase 2: one job, and a cron entry can call it directly until there is an API orchestrator.

**Goal:** the console images of each new API case are on local disk for OCR.

- `API_RECEIVED` cases: call middleware `GET /api/files/materials?scanId=API-<tpaCaseNumber>`, then
  `POST /api/files/download` into a folder named after the scanId.
- Writes `apiMaterialsResult` and `consoleBarcode` (from `barcodeId`).
- No materials yet: stay at `API_RECEIVED` and retry next run.
- To confirm in this phase:
  - the exact scanId format built from `tpaCaseNumber`;
  - which barcode to use when a scan has several submissions (`-01`, `-02`);
  - how long to wait for missing images before manual review.

## Phase 4: Email routing for API cases (shared plumbing)

**Goal:** API cases can send email, and customer replies come back to the API workflow.

- Outgoing: the first API email is a **new** email, not a reply. `email-sender` gets a "send new" path that creates
  the `EmailThread` and stores our `Message-ID`. The subject always contains the `tpaCaseNumber`.
- Recipients:
  - customer email: a fixed personal address from config for now; later the member-info email from IAS.
  - internal email: same as email cases (the claim route's `cc_email`).
- Incoming (`email-intake`):
  - add subject-tag matching after header matching (`api-case-workflow.md` section 7.2);
  - for API cases, waiting statuses (`API_INCOMPLETE`, `API_MEMBER_REVIEW_REQUIRED`) plus a stored attachment move
    to `API_REPLY_RECEIVED`;
  - any other `API_*` status: store and log only;
  - email-case logic stays unchanged.
- Tests:
  - a reply by header routes to the API case;
  - a new email with the `tpaCaseNumber` in its subject routes to the API case;
  - an unrelated email still creates an email case;
  - an API reply never moves a case into an email status.
  - each email is stored on exactly one case and marked seen only after that store succeeds; a failed store
    leaves it unread for the next run.

## Phase 5: `api-claim-recognition` job

- Reads `API_MATERIALS_DOWNLOADED` and `API_REPLY_RECEIVED`.
- Documents: the downloaded console images, plus attachments from customer replies.
- Reuses the existing recognition logic; only the document gathering differs from `claim-recognition`.

## Phase 6: `api-member-verification` and `api-document-checking` jobs, plus `email-sender`

- Same order as the email workflow: member check first, then documents.
- Reuse `member-verification/checks.js`, `member-verification/iasClient.js` and `document-checking/checklist.js`.
- Member-check issue: **internal** email. Missing documents: **customer** email (fixed address for now).

## Phase 7: `api-claim-preparation` job

- Reuses the diagnosis/benefit pickers and STP eligibility. The payload is for claim revision (shape confirmed in
  Phase 8).

## Phase 8: `api-claim-revision` job

- Waiting for the IAS claim revision API sample.
- Always revision, never create: `clNo` already exists in IAS.
- Includes: update barcode, diagnosis and benefit; set pend codes (`IAS_CL_PEND_CODE.xlsx`) when needed; validate.
- To confirm in this phase:
  - business rejection vs technical failure;
  - whether revision is safe to call again (a re-run after a reply calls it again);
  - the mapping from checklist issue to pend code.

## Phase 9: `api-claim-stp` job

- STP: fetch the CSR, as `ias-claim-stp` does. Non-STP: manual approval path.
- To confirm in this phase: what STP / non-STP means for API cases.

---

## Decisions log

| # | Decision | Date |
|---|---|---|
| D1 | API and email cases share `ulink_cases`, separated by `source` + `API_*` statuses + a DB check | 2026-09-24 |
| D2 | One inbox, one reader (`email-intake`); routing by reply headers, then `tpaCaseNumber` in the subject | 2026-09-24 |
| D3 | `tpaCaseNumber` is unique; `clNo` and `tpaCaseNumber` both unique for API cases | 2026-09-24 |
| D4 | `api-claim-intake` runs every 30 min; default date range is today (Myanmar time). Claims created after the day's last run need a manual re-run for that date | 2026-09-24 |
| D5 | Reply re-processing uses console images + reply attachments, then claim revision | 2026-09-24 |
| D6 | Customer email: fixed personal address for now, member-info email later | 2026-09-24 |
| D7 | Internal email: same recipient as email cases | 2026-09-24 |
| D8 | Console gets Email / API tabs for both the pipeline and the case list | 2026-09-24 |
| D9 | scanId = `API-{tpaCaseNumber}`; images come from the middleware **zip** endpoint, unpacked under ulink-api's own `API_MATERIAL_DOWNLOAD_ROOT` (middleware may move to another server) | 2026-09-24 |
| D10 | Download every submission of the scan; every barcode is stored in `api_materials_result.barcodes` | 2026-09-24 |
| D11 | No images in the console: continue anyway; documents come from the customer's reply and document checking asks for them | 2026-09-24 |

## Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | ~~Does `get_claim_api` need filtering?~~ No: it returns AYAS claims only (confirmed 2026-09-24) | Phase 1 |
| Q2 | Auth for `get_claim_api`: none, like the other IAS calls? | Phase 1 |
| Q3 | ~~scanId format~~ `API-{tpaCaseNumber}` (D9) | Phase 3 |
| Q4 | Which barcode goes into `console_barcode` for claim revision | Phase 8 |
| Q5 | IAS claim revision API sample | Phase 8 |
| Q6 | STP / non-STP meaning for API cases | Phase 9 |
