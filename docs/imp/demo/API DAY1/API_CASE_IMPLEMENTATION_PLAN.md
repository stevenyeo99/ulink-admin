# API Case Implementation Plan

Status: Phase 0, 1, 2, 2c, 3, 4, 5 and 6 built (2026-09-24); next: Phase 7 (claim preparation)  
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

## Phase 4: Email routing for API cases (shared plumbing) — BUILT 2026-09-24 (header matching)

Built as `api-reply-intake` with **no change to email-intake** (option a): replies matched by reply headers land on the
API case's thread, and the API job acts on them. The outgoing part was built in 6c. Subject fallback (S8) deferred.
The original design notes below are kept for reference.

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

## Phase 2c: Job input/output records and case documents — BUILT 2026-09-24

**Goal:** every API job receives the previous job's output explicitly, and console images are stored as records
like email attachments. Done now, while only 2 jobs exist.

- `ulink_api_case_steps`: one row per job run per case — `job`, `status`, `input`, `output`, `error`, timestamps.
  A job's input is the latest `DONE` output of the jobs it declares in `inputs`. Re-runs add rows (history).
- Shared API job runner: selects `source='API'` cases at the job's `inputStatus`, builds the input, calls
  `process(input)`, then in one transaction saves the step row, moves the status and writes the case event.
- `ulink_case_documents` (case level, `origin='CONSOLE'`): one row per console image, stored through the same
  storage adapter as email attachments (`STORAGE_ROOT`, key `api/<scanId>/<barcodeId>/<file>`); unique
  `(case_id, barcode_id, original_filename)` and an existing document is **skipped**, never replaced. Reply
  attachments stay in the email tables (message level). `API_MATERIAL_DOWNLOAD_ROOT` is removed.
- Drop `ulink_cases.ias_api_claim` / `api_materials_result` (empty) — the step table is the single source.
- Move `api-claim-intake` and `api-material-download` onto the runner, plus the fixes that belong to them (S1, S4,
  S5 below).
- Console: `GET /api/cases/:caseId/documents/:id` (ownership-checked, like attachments).

## Phase 5: `api-claim-recognition` job — BUILT 2026-09-24

Same prompts and post-processing as email OCR (calls `transcribePages` / `extractFields`, email module unchanged);
no route decision — always `ayas_member_claim` (D14). Schema mismatch → `API_MANUAL_REVIEW` for an operator (D15).

- Reads `API_MATERIALS_DOWNLOADED` and `API_REPLY_RECEIVED`.
- Documents: the downloaded console images, plus attachments from customer replies.
- Reuses the existing recognition logic; only the document gathering differs from `claim-recognition`.

## Phase 6: `api-member-verification` and `api-document-checking` jobs, plus `email-sender`

- **6a/6b — BUILT 2026-09-24.** Both jobs call the email modules' own `checkCase` (unchanged) with the OCR output.
  The member check re-checks `API_MEMBER_REVIEW_REQUIRED` every run (S14). Each output records the email the email
  flow would send (`email: { taskType, audience }`).
- **6c — BUILT 2026-09-24.** `api-email-sender`: its own sender (never `ulink_email_tasks`), same templates and
  channel adapter; first email starts the case thread, subject carries the `tpaCaseNumber`, same dedupe rule. No
  email-side code changed. Customer address `API_CASE_CUSTOMER_EMAIL` = steven.yeo@dynrtech.com (Q9).

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

## Scenarios to handle

Found while walking through API case edge cases (2026-09-24). ⚠️ = can lose a claim or harm data if missed.

| # | Scenario | Handling | Phase |
|---|---|---|---|
| S1 | ⚠️ IAS or our server down for a day, or a claim created after the day's last run | Query from the last successful intake date (`ulink_job_checkpoints`); duplicates are blocked anyway | 2c ✓ |
| S2 | Same `tpaCaseNumber` returned under a new `clNo` | Rejected and reported (built); operator decides | 1 ✓ |
| S3 | Claim cancelled in IAS after intake | Check claim status before revision; skip if cancelled | 8 |
| S4 | No console images yet on first download | Grace period 2 h after IAS `crtDate`, staying `API_RECEIVED` (WAITING); then `API_NO_DOCUMENTS` → customer asked for documents (Phase 6) | 2c ✓ / 6 |
| S5 | Partial download (fewer files than the console lists) | WAITING; keep what arrived, fetch only the rest next run | 2c ✓ |
| S6 | Customer uploads more pages to the console while the case waits | Re-check the console each run while waiting; new pages → back to OCR | 6 |
| S7 | Blurry / unreadable images | Unreadable values come back `unclear`/missing (same prompt as email) and document checking asks for them; a schema mismatch → `API_MANUAL_REVIEW` | 5 ✓ / 6 |
| S8 | ⚠️ Customer sends a brand-new email without `tpaCaseNumber` | Would become an email case and could create a second IAS claim. Duplicate check: same member + treatment date as an open API case → flag, don't create | 4 |
| S9 | Reply arrives while the case is processing (not waiting) | Keep it; include its attachments the next time the case is read (OCR reads every reply) | 4 ✓ |
| S10 | Reply after revision already done | Store and alert internally; no reprocessing | 4 |
| S11 | Customer email address unknown (fixed address for now) | Production blocker — use the member-info email | 6 |
| S12 | Email bounces | Flag for an operator | 6 |
| S13 | ⚠️ Customer never replies | Reminder after N days, close/escalate after M days | 6 |
| S14 | ⚠️ Member-check issue fixed by the internal team in IAS (no customer reply will come) | Re-checked every run like email cases; moves on once IAS is fixed | 6 ✓ |
| S15 | ⚠️ A person already changed/approved the claim in IAS | Check claim status before revising; only revise at the expected status | 8 |
| S16 | Revision timeout (outcome unknown) | Check the claim in IAS before resending | 8 |
| S17 | Revision runs again after a reply | Must be safe to repeat — confirm with the IAS sample | 8 |
| S18 | Reply with no attachment | Store, keep waiting, send the "no attachment" reminder (as email cases) | 4 ✓ |
| S19 | Long thread: internal and customer emails share one thread, so a customer email may reply to an internal one the customer never received | Customer emails reply to the latest customer-facing message; internal emails keep their own chain | 4 ✓ |
| S20 | Long thread: every reply must be handled exactly once across many rounds | `api-reply-intake` records the message ids it handled; later rounds take only new ones | 4 ✓ |
| S21 | Long thread: OCR re-reads console images + all reply attachments every round; re-attached duplicates; prompt size grows | Skip identical attachments (content hash); flag manual review if too large; cache page transcripts when needed | 4 ✓ |

## Build order

2c → 5 → 6 → 4 → 7 → 8 → 9. Phase 4 (reply routing) comes after 6 because replies only exist once API emails are
sent (Phase 6).

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
| D9 | scanId = `API-{tpaCaseNumber}`; images come from the middleware **zip** endpoint, stored on ulink-api's side (middleware may move to another server) — storage superseded by D13 | 2026-09-24 |
| D10 | Download every submission of the scan; every barcode is kept in the job's step output (D12) | 2026-09-24 |
| D11 | No images in the console: continue anyway (after the S4 grace period); documents come from the customer's reply and document checking asks for them | 2026-09-24 |
| D12 | Each API job receives the previous jobs' outputs explicitly, stored per run in `ulink_api_case_steps` | 2026-09-24 |
| D13 | Console images are case-level records (`ulink_case_documents`) in the same storage as email attachments; an existing document is skipped | 2026-09-24 |
| D14 | API claims are always AYAS member claims: API OCR skips the route decision and extracts with `ayas_member_claim` | 2026-09-24 |
| D15 | OCR that can't produce valid fields → `API_MANUAL_REVIEW` (operator) now; a customer email for it may come with Phase 6 | 2026-09-24 |

## Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | ~~Does `get_claim_api` need filtering?~~ No: it returns AYAS claims only (confirmed 2026-09-24) | Phase 1 |
| Q2 | Auth for `get_claim_api`: none, like the other IAS calls? | Phase 1 |
| Q3 | ~~scanId format~~ `API-{tpaCaseNumber}` (D9) | Phase 3 |
| Q4 | Which barcode goes into `console_barcode` for claim revision | Phase 8 |
| Q5 | IAS claim revision API sample | Phase 8 |
| Q6 | STP / non-STP meaning for API cases | Phase 9 |
| Q7 | ~~S4 grace period~~ 2 hours after `crtDate` (`API_MATERIAL_GRACE_MINUTES`), confirmed 2026-09-24 | Phase 2c |
| Q8 | S13 reminder / close timings (N and M days) | Phase 6 |
| Q9 | ~~Fixed customer email address~~ steven.yeo@dynrtech.com (`API_CASE_CUSTOMER_EMAIL`), confirmed 2026-09-24 | Phase 6c |
