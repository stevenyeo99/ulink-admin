# ulink-admin — Design

Why the system is built the way it is, and what changes when it scales. How each job behaves today is in
[docs/imp/CLAIM_FLOW_END_TO_END.md](docs/imp/CLAIM_FLOW_END_TO_END.md); this file is the reasoning behind it.

---

## 1. Components

```
 customer email ──► IMAP inbox ─┐                                   ┌─► IAS (AYA Sompo core)
                                 │                                   │    member info · claim create/revise
 customer console upload ──► console middleware ◄─┐                  │    claim status · settlement report
                                 │                 │                  │
                        ┌────────▼─────────────────┴─────────┐        │
                        │ ulink-api (Express, one process)    ├───────┘
                        │  jobs + orchestrators + REST API    ├──► local LLM server (vision, chat, embeddings)
                        │  Postgres + pgvector (Sequelize)    ├──► SMTP (replies, team emails)
                        └────────▲────────────────────────────┘    cl-upload (console upload by API)
                                 │ REST (JWT)
                        ulink-console (React/Vite) — CSR / Ops / JD3 / super admin
```

- **ulink-api** — one Node process: the REST API for the console, every job, and two orchestrators
  (`POST /api/jobs/pipeline/run` email, `POST /api/jobs/api-pipeline/run` API), triggered by cron.
- **Postgres** (Supabase) with **pgvector** for the ICD-10 and policy-exclusion searches. Every table `ulink_…`.
- **Local LLM** (LM Studio, OpenAI-compatible): page reading (vision), recognition/extraction, judgments, diagnosis
  and benefit picks, Burmese translation, embeddings. No cloud AI: claim documents stay on the network.
- **ulink-console** — the working dashboard (overview, review queue, approvals, cases, STP settings, pipeline).

---

## 2. Pipeline design

**Status chain.** A job selects cases by `Case.currentStatus`, processes them, writes the next status. Jobs never
call each other, so each can be run, retried or replaced alone; a case's position is always one column.

**Orchestrators run every step, every time, in order** (`modules/pipeline/service.js`). No branching: a job with
nothing at its status does nothing. A case moves as far as it can in one run. A failing step is recorded and the rest
continue (`continue-on-error`) — steps are independent through the status chain.

**Locks.** Each job and orchestrator holds a Postgres-backed lock (`ulink_job_locks`); an overlapping trigger skips
instead of running twice. `POST …/release` clears a lock left by a crash.

**Idempotent by design.** Emails are queued as tasks with a dedupe key (same problem → no second email). IAS claim
creation is not idempotent, so it runs once per case and a business rejection is not retried; a technical failure
leaves the status so the next run retries. Waits (barcode, settlement report, member record fixed) are statuses
re-checked every run, not timers.

**Email vs API cases** share the checks but not the jobs: `source` + an `API_…`-only status rule (DB constraint)
keep each flow's jobs from ever selecting the other's cases. API jobs record each step's input/output in
`ulink_api_case_steps` (`runApiJob`); email jobs write results onto `ulink_cases`. `apiCaseView()` maps API step
outputs onto the email field names so the console and summary read one shape.

---

## 3. AI design

| Use | Where | Guard |
|---|---|---|
| Page reading + extraction | claim-recognition | Route confidence threshold → *Needs manual reading* below it; schema validation |
| Name / identity / legibility judgments | member & document checks | Confidence; low confidence is a review point |
| Policy exclusion | member check | RAG over hand-transcribed clauses; below 0.5 → no flag; a flag is a warning, never a stop |
| Burmese → clinical English | claim preparation | Only for the picks; the IAS payload keeps the original text; marked *AI translated* |
| Diagnosis | claim preparation | ICD-10 exact vector search + AI re-rank with reason; not confident → `R69` (never STP) |
| Benefit type/head | claim preparation | Only from the member's own plan; not confident → blank (never STP) |

Principles:
- **One confidence bar (0.5)** across judges, so "AI unsure" means one thing everywhere.
- **The AI proposes, rules decide the money.** STP is a rule decision (limits, never-STP diagnoses, optional
  review-point block); JD3 approves everything else in IAS.
- **Explanations are not generated.** The assessment summary and "why the case went this way" are built by rules
  from stored results (`modules/assessment-summary/`), so the same case always explains the same way, costs no LLM
  call, and can be sent to IAS (`AiSummaryRemark`) and emails.
- **Confidently wrong is the residual risk.** Confidence gates only catch cases the AI knows it is unsure about;
  STP limits cap the rest; a random audit sample (backlog) is the detection step.

---

## 4. Human in the loop

- **Review queue** — every *needs review* status plus open cases with review points, grouped by reason.
- **Override and continue** — for checks the AI may have got wrong (documents, member, held document check);
  recorded with person, finding and reason; overridden points stay visible, marked handled, everywhere.
- **Switches** (`ulink_settings`, console, off by default): open review point blocks STP; hold the customer's
  missing-documents email when the AI is unsure.
- **JD3** approves non-STP claims in IAS with the assessment in the approval email.

Roles: one role today, `super_admin`, for every action (override, reset, settings). Finer roles wait on the
"who can act" decision (backlog).

---

## 5. Integrations

| System | Calls | Notes |
|---|---|---|
| IAS | member info; claim create (email cases); claim revision (API cases); claim status + file download; `get_claim_api` | Dates are MMDDYYYY in most IAS fields (`modules/shared/iasDates.js` owns every conversion). Business answers come back as `success: false`, not HTTP errors |
| Console middleware | API case images (materials + zip); barcodes by `scanId` | Same service for API images and cl-upload barcodes |
| cl-upload | one merged PDF per email case | Barcode arrives later (console job every 15 min) → the `console-barcode` wait |
| Email | IMAP in, SMTP out | Email cases: replies in the customer's thread. API cases: own threads; customer and team kept apart |

Every external call has an `AbortController` timeout.

---

## 6. Data

Core: `ulink_cases` (email results in JSONB columns: `extractedFields`, `memberVerifyResult`,
`documentCheckResult`, `claimPrepMeta`, …), `ulink_case_events` (history; `rawRef` holds audit snapshots),
`ulink_api_case_steps`, `ulink_email_threads/messages/attachments`, `ulink_email_tasks`, `ulink_case_documents`.
Configuration: `ulink_claim_routes`, `ulink_stp_rules`, `ulink_stp_blocked_diagnoses`, `ulink_settings`,
`ulink_policy_exclusion_clauses`, `ulink_icd10_diagnoses`. Files: local storage adapter (`STORAGE_ROOT`) — location
and retention are an open decision.

---

## 7. Scaling up

What holds today, and what to change first as volume or scope grows.

| Area | Today | Ceiling | Next step |
|---|---|---|---|
| Throughput | One process; orchestrator steps sequential; LLM calls one at a time (local server); batch limits per job | A few hundred cases/day, bound by LLM time per case (minutes) | Run jobs as separate workers on the same status chain (locks already per job); more/larger LLM servers; parallel LLM calls per job with a concurrency cap |
| Scheduling | Cron → orchestrator endpoints | One trigger interval for all steps | Per-job cron lines (endpoints exist) or a queue; the status chain doesn't change |
| New claim types / insurers | Routes table (`ulink_claim_routes`), one route enabled (`ayas_member_claim`); console-upload hard-codes it | Each route needs its own checklist, schema and IAS mapping | Add a route row + its field schema + checklist; STP rules already keyed by case type and benefit type |
| Currency | MMK only (payload hard-codes it) | Foreign-currency claims | Currency from extraction + exchange rate; STP rules already carry a currency column |
| Roles | `super_admin` only | CSR / Ops / JD3 need different rights | Role on `ulink_users` + `requireRole` per action once "who can act" is decided |
| Storage | Local disk | Retention, sharing, backups | Storage adapter interface exists (`src/ulink-api/storage`); add S3/other behind it |
| Audit | Case history + snapshots; STP rule changes not recorded | Compliance review | Change history for settings/rules (parked A1) |
| Learning | Overrides recorded with a finding | No accuracy numbers yet | Reviewer actions → accuracy per confidence band → calibrated STP confidence rule |

Invariants to keep while scaling: the status chain, the Email/API separation constraint, "technical failure retries /
business answer goes to review", reasons stored with every decision.

---

## 8. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-01 | Member check before document check | Eligibility first; the document check owns the final "checks passed" |
| 2026-09-24 | API cases as their own flow with `API_…` statuses, step records, claim revision (never create) | The claim already exists in IAS; keep the email flow untouched |
| 2026-09-28 | Explanations built by rules, not generated | Consistent, free, sendable to IAS |
| 2026-09-28 | Console login (JWT), super admin for write actions | Actions must be attributable |
| 2026-09-29 | STP rules per case type + IAS benefit type; never-STP diagnoses; R69 blocked | STP must not rely on amount alone (17/09 meeting) |
| 2026-09-29 | `AiSummaryRemark` on every IAS create/revise (≤ 10,000 chars) | Audit trail in IAS (17/09 #9) |
| 2026-09-29 | cl-upload with a barcode wait status; folder copy kept as fallback | Console issues barcodes asynchronously |
| 2026-09-29 | Human-check switches, off by default | Ulink decides; no behaviour change until then |
