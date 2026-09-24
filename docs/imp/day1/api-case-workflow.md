# API Case Workflow

Developer reference for how API cases move through the system: where they come from, which jobs touch them, how
they stay separate from email cases, and how customer email replies bring them back into the workflow.

- Email case workflow: [jobs-registry.md](jobs-registry.md)
- Delivery phases, decisions and open questions: [API_CASE_IMPLEMENTATION_PLAN.md](../demo/API%20DAY1/API_CASE_IMPLEMENTATION_PLAN.md)

> **Build status.** Most of this workflow is not built yet. Each section and job shows its phase. Update this file
> in the same change that builds or changes a job, so it always describes the system as it actually is.

---

## 1. What an API case is

The system handles two kinds of case. They share one database table, one inbox and the same business rules, but
each has its own jobs.

| | Email case | API case |
|---|---|---|
| Starts from | A new email in the inbox | A claim listed by IAS `get_claim_api` |
| Documents | Email attachments | Console images (via ulink-console-middleware) + attachments from customer replies |
| IAS action | Create a claim (`CL_CLAIM_API`) | Revise an existing claim (the claim already exists in IAS) |
| Orchestrator | `POST /api/jobs/pipeline/run` | `POST /api/jobs/api-pipeline/run` |
| `ulink_cases.source` | `EMAIL` | `API` |
| Statuses | `EMAIL_RECEIVED`, `RECOGNIZED`, … | Always prefixed `API_` |

### Terms

| Term | Meaning | Example |
|---|---|---|
| `clNo` | IAS claim number. Stored in `ulink_cases.claim_no` | `2604050015` |
| `tpaCaseNumber` | TPA case reference from IAS. Unique. Stored in `ulink_cases.tpa_case_number` | `STEVENEVERHILLC58` |
| scanId | Console scan id; the search key for the case's images in the middleware | `API-AYA-CL-26034880` |
| submission | One console upload under a scanId, with its own barcode. A scanId can have several (`-01`, `-02`) | `API-AYA-CL-26034880-01` |
| material | One page image of a submission, downloaded from the graph service by id | `page-000.jpg` |

## 2. End-to-end flow

```mermaid
flowchart TD
  IAS[IAS get_claim_api<br/>every 30 min] --> A[api-claim-intake<br/>API_RECEIVED]
  A --> B[api-material-download<br/>API_MATERIALS_DOWNLOADED]
  B --> C[api-claim-recognition<br/>API_RECOGNIZED]
  C --> D{api-member-verification}
  D -- issue --> DM[API_MEMBER_REVIEW_REQUIRED<br/>internal email]
  D -- ok --> E{api-document-checking}
  E -- missing docs --> EI[API_INCOMPLETE<br/>customer email]
  E -- ok --> F[api-claim-preparation<br/>API_CLAIM_PAYLOAD_PREPARED]
  F --> G[api-claim-revision<br/>API_CLAIM_REVISED]
  G --> H[api-claim-stp<br/>API_CSR_SENT]
  DM -. reply .-> R[email-intake routes reply<br/>API_REPLY_RECEIVED]
  EI -. reply .-> R
  R --> C
```

In words:

1. Every 30 minutes the API orchestrator asks IAS for API claims created today (Myanmar time), and creates one case
   per new `clNo`.
2. It downloads that claim's page images from the console and stores them as case documents (waiting up to 2 hours
   if the console has none yet).
3. OCR reads the images.
4. Member check, then document check. If either fails, an email goes out and the case waits.
5. When the customer replies, the reply's attachments are added and the case goes back to OCR with the console
   images plus the new attachments.
6. Once both checks pass, the claim payload is prepared and sent to IAS as a **claim revision**. It is never a new
   claim, because `clNo` already exists in IAS.
7. STP claims continue to the settlement report.

## 3. Rules that keep API and email cases apart

These are the invariants. Any change that could break one needs a test proving it still holds.

| # | Rule | Enforced by |
|---|---|---|
| 1 | Every case has `source` = `EMAIL` or `API`, set at creation and never changed | Column default `EMAIL`; only `api-claim-intake` writes `API` |
| 2 | An API case only ever holds `API_*` statuses, and an email case never does | DB check: `(source = 'API') = (current_status LIKE 'API\_%')` |
| 3 | Email jobs never select API cases | They filter on exact email statuses, which rule 2 makes impossible for API cases. **Email job queries need no `source` filter**; don't add `API_*` handling to them |
| 4 | API jobs never select email cases | Every API job filters `source = 'API'` **and** its `API_*` status |
| 5 | An incoming email reaches the right case | `email-intake` routing (section 7.2) |
| 5a | Each email is stored on **exactly one** case (API or email) and marked `\Seen` only **after** it is stored on that case. If storing fails it stays unread and is retried | `email-intake` is the only inbox reader; it dedupes on `ulink_email_messages` (`source` + `externalId`) and flags `\Seen` after the store succeeds |
| 6 | One IAS claim becomes at most one case | Unique indexes on `claim_no` and `tpa_case_number` where `source = 'API'` |
| 7 | An API case is never sent to IAS claim creation | Rule 2: `ias-claim-creation` only reads `CLAIM_PAYLOAD_PREPARED` |

Rules 1, 2 and 6 are **built** (migration `20260924100000-add-api-case-source.js`; constraint names
`ulink_cases_source_check`, `ulink_cases_source_status_match`, indexes `ulink_cases_api_claim_no_unique`,
`ulink_cases_api_tpa_case_number_unique`). Tests: `tests/caseSourceConstraint.test.js` checks them against the real
DB; `tests/emailJobIsolation.test.js` runs every email job and fails if one selects cases without an exact,
non-`API_` status filter. **Adding a new email job? Add it to that test's `EMAIL_JOBS`.**

Rule 2 is the one that makes the rest safe. Even a bug or a manual `UPDATE` can't put an API case into an email
status, so the email pipeline can't pick it up.

## 4. Case lifecycle

```mermaid
stateDiagram-v2
  [*] --> API_RECEIVED: api-claim-intake
  API_RECEIVED --> API_MATERIALS_DOWNLOADED: api-material-download
  API_RECEIVED --> API_NO_DOCUMENTS: no images after grace period
  API_MATERIALS_DOWNLOADED --> API_RECOGNIZED: api-claim-recognition
  API_REPLY_RECEIVED --> API_RECOGNIZED: api-claim-recognition
  API_RECOGNIZED --> API_READY_FOR_DOCUMENT_CHECKING: member ok
  API_RECOGNIZED --> API_MEMBER_REVIEW_REQUIRED: member issue
  API_READY_FOR_DOCUMENT_CHECKING --> API_DOCUMENTS_VERIFIED: docs ok
  API_READY_FOR_DOCUMENT_CHECKING --> API_INCOMPLETE: docs missing
  API_MEMBER_REVIEW_REQUIRED --> API_REPLY_RECEIVED: reply with attachment
  API_INCOMPLETE --> API_REPLY_RECEIVED: reply with attachment
  API_DOCUMENTS_VERIFIED --> API_CLAIM_PAYLOAD_PREPARED: api-claim-preparation
  API_CLAIM_PAYLOAD_PREPARED --> API_CLAIM_REVISED: api-claim-revision
  API_CLAIM_PAYLOAD_PREPARED --> API_CLAIM_REVISION_FAILED: IAS rejects
  API_CLAIM_REVISED --> API_CSR_SENT: api-claim-stp (STP only)
```

| Status | Meaning | Set by | Picked up by | Phase |
|---|---|---|---|---|
| `API_RECEIVED` | New claim from IAS; no images yet | `api-claim-intake` | `api-material-download` | 1 |
| `API_MATERIALS_DOWNLOADED` | Console images stored as case documents | `api-material-download` | `api-claim-recognition` | 3 |
| `API_NO_DOCUMENTS` | No console images after the grace period; the customer will be asked | `api-material-download` | document checking (email) | 2c / 6 |
| `API_REPLY_RECEIVED` | Customer replied with attachments while the case was waiting | `email-intake` | `api-claim-recognition` | 4 |
| `API_RECOGNIZED` | OCR done | `api-claim-recognition` | `api-member-verification` | 5 |
| `API_MANUAL_REVIEW` | Extraction didn't fit the `ayas_member_claim` schema; waits for an operator | `api-claim-recognition` | operator | 5 |
| `API_MEMBER_REVIEW_REQUIRED` | Member/coverage issue (internal email: 6c). Re-checked every run; **also waits for a reply** | `api-member-verification` | `api-member-verification` (re-check), `email-intake` (reply) | 6 |
| `API_READY_FOR_DOCUMENT_CHECKING` | Member check passed | `api-member-verification` | `api-document-checking` | 6 |
| `API_INCOMPLETE` | Documents missing (customer email: 6c). **Waits for a reply** | `api-document-checking` | `email-intake` (on reply) | 6 |
| `API_DOCUMENTS_VERIFIED` | Both checks passed | `api-document-checking` | `api-claim-preparation` | 6 |
| `API_CLAIM_PAYLOAD_PREPARED` | Revision payload built | `api-claim-preparation` | `api-claim-revision` | 7 |
| `API_CLAIM_REVISED` | IAS accepted the revision | `api-claim-revision` | `api-claim-stp` | 8 |
| `API_CLAIM_REVISION_FAILED` | IAS rejected the revision (business answer; not retried) | `api-claim-revision` | operator | 8 |
| `API_CSR_SENT` | Settlement report sent (STP only) | `api-claim-stp` | end | 9 |

Statuses from Phase 3 onward are provisional until their phase is built.

## 5. Orchestrator and scheduling

**Built (Phase 2).** Today's steps (`API_STEPS` in `modules/pipeline/service.js`):

```
POST /api/jobs/api-pipeline/run        cron: every 30 minutes; lock 'api-pipeline'
  1. api-claim-intake
  2. api-material-download
  3. api-claim-recognition
  4. api-member-verification
  5. api-document-checking
```

Endpoints: `/api/jobs/api-pipeline/run`, `/release`, `/runs`, `/runs/:id` — they only ever see `pipeline='API'`
runs (`ulink_pipeline_runs.pipeline`). The email orchestrator (`/api/jobs/pipeline/*`, lock `pipeline`) is unchanged
and only sees `EMAIL` runs. The console shows each on its own tab (`?source=api`), and the cases list likewise.

Planned full order, as each phase adds its job:

```
  1. api-claim-intake
  2. email-intake              shared with the email pipeline      (Phase 4)
  3. api-material-download
  4. api-claim-recognition                                         (Phase 5)
  5. api-member-verification                                       (Phase 6)
  6. api-document-checking                                         (Phase 6)
  7. email-sender              shared                              (Phase 6)
  8. api-claim-preparation                                         (Phase 7)
  9. api-claim-revision                                            (Phase 8)
 10. api-claim-stp                                                 (Phase 9)
 11. email-sender              shared                              (Phase 9)
```

- **Same runner as the email pipeline.** `modules/pipeline/service.js` gives each step a lock, a timeout and a
  `ulink_pipeline_run_steps` row. The API pipeline passes its own step list; runs are stored with
  `pipeline = 'API'`.
- **No branching in the orchestrator.** Every step runs every time, and each job only picks up cases in its own
  status. A case that one step moves forward is visible to the next step in the same run.
- **Shared jobs** (`email-intake`, `email-sender`) run in both pipelines with the **same lock**. If the email
  pipeline is running one of them, the API pipeline's step is `SKIPPED`, which is normal. The next run catches up.
- **Why `email-intake` is a step here:** there is only one inbox, so there must be only one reader. Two readers
  would compete over unread messages. Running the shared reader from both pipelines means API replies are picked up
  on the API schedule too.
- Every job also has its own `POST /api/jobs/<name>/run` and `/release`, for testing or re-running one step.

## 6. Jobs

**Each job's input is the previous job's output.** This is the orchestrator's core idea:

```
job 1  input: IAS list                 → output 1
job 2  input: { job 1: output 1 }      → output 2
job 3  input: { job 2: output 2 }      → output 3
```

- **Contract in code.** A per-case job is a plain object run by `modules/api-pipeline/runApiJob.js`:
  ```js
  { name, inputStatus, inputs: ['<earlier job>'], batchLimit,
    process({ caseRecord, input }) → { output, nextStatus, message } | { wait: true, output } }
  ```
  `input` is `{ [earlierJob]: its latest DONE output }` — nothing else. A job that needs several earlier results
  names several (e.g. claim preparation will take recognition, member check and document check).
- **Stored per run.** `ulink_api_case_steps` keeps one row per job run per case: `input`, `output`, `error`,
  `status` (`DONE` / `WAITING` / `FAILED`) and timestamps. It is the single source of every API job's data; the case
  row only holds identity and status. A re-run adds a row, so history is kept.
- **The runner owns the rest:** picks `source='API'` cases at `inputStatus`, builds the input, calls `process`,
  then in **one transaction** saves the `DONE` row, moves the status (only if the case is still at `inputStatus`) and
  writes the `ulink_case_events` row. `WAITING` (nothing to do yet) and `FAILED` (technical error) leave the case
  where it is for the next run; repeating the same outcome updates the latest row instead of adding one each run.
- Jobs never call each other.

### 6.1 `api-claim-intake` (Phase 1, reworked in 2c)

| | |
|---|---|
| Module | `modules/api-claim-intake/` (`iasClient.js`, `service.js`) |
| Job | `POST /api/jobs/api-claim-intake/run`. Tests: `tests/apiClaimIntake.test.js` |
| Test endpoint | `GET /api/dev/api-claim-intake/preview?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` (real IAS call, saves nothing) |
| Calls | `GET {IAS_URL}{GET_CLAIM_API}?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` |
| Input | The IAS list (it creates cases, so it doesn't use the per-case runner) |
| Output (step row per new case) | `{ clNo, tpaCaseNumber, crtDate }` — the input of `api-material-download` |
| Writes | New case (`source='API'`, `claim_no`, `tpa_case_number`, `API_RECEIVED`), its `DONE` step row, a case event; the `ulink_job_checkpoints` row |
| Returns | `{ dateFrom, dateTo, fetched, inserted, skippedExisting, skippedInvalid, errors }` |

Logic:

1. **Date range = from the last successfully listed date up to today**, in Myanmar time (UTC+6:30,
   `todayInIasTimezone()` — the server runs on WIB, UTC+7). The last date is kept in `ulink_job_checkpoints`
   (`job='api-claim-intake'`, `value.lastListedDate`). Normally that is today → today; after an outage it reaches
   back over every missed day (S1). The last day is listed again on purpose, since more claims may have been created
   on it after that run. A first run lists today only.
2. Call IAS. On a timeout, a non-2xx response or `success: false`, write nothing (checkpoint unchanged). The next
   run retries the same range.
3. Create each claim's case with `Case.findOrCreate` on (`source='API'`, `claim_no`), in one transaction with its
   step row and case event. The unique indexes are the real guard: a clash (e.g. the same `tpaCaseNumber` under a
   new `clNo`) fails that claim and is reported in `errors`; it is never merged. A claim that already has a case is
   left alone.
4. A row without `clNo` or `tpaCaseNumber` is skipped and reported; the rest still go in.
5. After IAS answered, the checkpoint moves to today.
6. An **explicit range** (`run({ dateFrom, dateTo })`, a manual catch-up) is used as given and doesn't move the
   checkpoint.

### 6.2 `email-intake` (shared, API behavior from Phase 4)

See section 7.2.

### 6.3 `api-material-download` (Phase 3, reworked in 2c)

| | |
|---|---|
| Module | `modules/api-material-download/` (`middlewareClient.js`, `service.js`) — a runner job |
| Job | `POST /api/jobs/api-material-download/run`. Tests: `tests/apiMaterialDownload.test.js` |
| Input status | `API_RECEIVED` |
| Input | `{ 'api-claim-intake': { clNo, tpaCaseNumber, crtDate } }` |
| Calls | ulink-console-middleware (`CONSOLE_MIDDLEWARE_URL`): `GET /api/files/materials?scanId=…` (all pages), then `POST /api/files/download/zip` |
| Writes | One `ulink_case_documents` row per image (file through the storage adapter, `STORAGE_ROOT/api/<scanId>/<barcodeId>/<file>`) |
| Output | `{ scanId, fileCount, documents: [{ barcodeId, scanId, createdAt, expected, documentIds }] }` |
| Next | `API_MATERIALS_DOWNLOADED`, or `API_NO_DOCUMENTS` |

Logic:

1. **scanId = `API-{tpaCaseNumber}`.**
2. **List every page** of the scan's submissions. The middleware's scanId search is a *contains* match
   (`API-X68` also returns `API-X688-01`), so only the exact scanId and its numbered submissions (`API-X68-01`,
   `API-X68-02`) are kept.
3. **No images in the console:**
   - within `API_MATERIAL_GRACE_MINUTES` (default 120) after the IAS claim's `crtDate` → **WAITING**, retried next
     run (the console may still be uploading, S4);
   - after that → `API_NO_DOCUMENTS` with `fileCount: 0`; the customer will be asked for documents (Phase 6).
4. **Download** only the submissions still missing pages, as zips (at most 100 images per request). Every zip entry
   must be exactly `<scanId>/<one of this scan's barcodes>/<safe file name>`, or the case fails.
5. **Store each image as a case document** through the same storage adapter as email attachments. An image that
   already exists (same case + barcode + file name) is **skipped**, never replaced. Every barcode is kept, with
   `expected` = how many images the console listed.
6. **Partial download** (fewer stored than expected) → **WAITING**; what arrived is kept and only the rest is
   fetched next run (S5). An image that can never be downloaded keeps the case waiting; the step row shows
   "x of y images downloaded" for an operator.
7. **Middleware down / timeout** → **FAILED**, retried next run.

`console_barcode` is not set yet: which barcode claim revision needs is decided in Phase 8.

### 6.4 `api-claim-recognition` (Phase 5, built 2026-09-24)

| | |
|---|---|
| Module | `modules/api-claim-recognition/service.js` — a runner job |
| Job | `POST /api/jobs/api-claim-recognition/run`. Tests: `tests/apiClaimRecognition.test.js` |
| Input status | `API_MATERIALS_DOWNLOADED` |
| Input | `{ 'api-material-download': { scanId, fileCount, documents: [{ barcodeId, documentIds }] } }` |
| Output | `{ recognizedType: 'ayas_member_claim', extractedFields, pageCount, transcripts }` |
| Next | `API_RECOGNIZED`, or `API_MANUAL_REVIEW` (`reasonCode: 'SCHEMA_VALIDATION_FAILED'`) |

Logic:

1. **Same OCR as email cases.** It calls the email flow's own exported functions, unchanged: `transcribePages` (the
   same page-transcription prompt) and `extractFields` (the same extraction prompt and schema, plus the same
   post-processing — invoice dedupe, DOB / delegation-letter normalisation, medical-record fallback). The email job
   itself is not modified.
2. **No route decision.** API claims are always AYAS member claims (confirmed 2026-09-24), so it extracts with the
   `ayas_member_claim` route from `ulink_claim_routes` directly. An API case can't come out "not recognized".
3. **Documents:** the case documents named in the input, read through the storage adapter. Each page is labelled
   `[<barcodeId>/<file> - page N]` — the same label shape as email attachments (the medical-record fallback groups
   pages by it); the barcode is included because every console submission numbers its pages from `page-000.jpg`.
4. **Extraction doesn't fit the schema** → `API_MANUAL_REVIEW`, waiting for an operator (decided 2026-09-24; a
   customer email for this comes with Phase 6).
5. **Route missing / a document gone / LLM or storage error** → FAILED, retried next run.
6. The transcripts are kept in the output, so what the model read can be checked per case.

Reply attachments (Phase 4) will be added as a second input (`inputs: ['api-material-download', 'email-reply']`).
Verified on the sample scan: 7 pages → `API_RECOGNIZED` in about a minute.

### 6.5 `api-member-verification` and `api-document-checking` (Phase 6, built 2026-09-24 — emails pending)

Both are runner jobs that hand the OCR output to the **email flow's own check, unchanged** — the exported `checkCase`
of `member-verification` / `document-checking`, which only reads `id`, `extractedFields` and `recognizedType`. Same
order as email: member check first, then documents. Tests: `tests/apiChecks.test.js`.

| | `api-member-verification` | `api-document-checking` |
|---|---|---|
| Job | `POST /api/jobs/api-member-verification/run` | `POST /api/jobs/api-document-checking/run` |
| Input status | `API_RECOGNIZED`, and `API_MEMBER_REVIEW_REQUIRED` (re-checked every run) | `API_READY_FOR_DOCUMENT_CHECKING` |
| Input | `{ 'api-claim-recognition': { extractedFields, recognizedType } }` | same |
| Does | IAS member lookup + every member rule (hard/soft checks, exclusions, benefit eligibility and limits) | the full checklist + entity-match judgments |
| Output | `{ outcome, memberVerifyResult, iasMemberInfoResponse, email }` | `{ outcome, documentCheckResult, email }` |
| Next | `API_READY_FOR_DOCUMENT_CHECKING` / `API_MEMBER_REVIEW_REQUIRED` | `API_DOCUMENTS_VERIFIED` / `API_INCOMPLETE` |

- **Member issue fixed in IAS (S14):** a case at `API_MEMBER_REVIEW_REQUIRED` is re-checked every run, as email cases
  are. Still failing → WAITING (no new row, no status change); passing → moves on by itself.
- **Document check input:** the OCR output, not the member check's — the checklist only needs the extracted fields.
- **Emails are not sent yet.** Each output's `email` says which email the email flow sends for that outcome
  (`MEMBER_VERIFY_ISSUE` → internal; `MISSING_DOCUMENTS` / `DOCUMENT_COMPLETE_ACK` → customer). Queuing an
  `EmailTask` today would reach the shared `email-sender`, which can only reply inside an existing thread — API cases
  have none. Sending them is step 6c, together with reply routing (Phase 4), so the shared email code changes once.

Verified on the sample scan: download → OCR → member verified (IAS) → documents incomplete ("Incomplete medical
report(s)", missing case number, missing claimant DOB), about a minute end to end.

### 6.6 `api-claim-preparation` (Phase 7)

Reuses the diagnosis/benefit pickers and STP eligibility. Builds the claim revision payload. Writes
`ias_claim_payload`, `claim_prep_meta`.

### 6.7 `api-claim-revision` (Phase 8)

Sends the revision to IAS: updates barcode, diagnosis and benefit, sets pend codes (`IAS_CL_PEND_CODE`) when needed,
and validates. A business rejection → `API_CLAIM_REVISION_FAILED`, not retried. A technical failure → stays at
`API_CLAIM_PAYLOAD_PREPARED` and is retried. Waiting for the IAS sample.

### 6.8 `api-claim-stp` (Phase 9)

STP claims: fetch the settlement report like `ias-claim-stp`. Non-STP: manual approval. To be confirmed.

## 7. Email

### 7.1 Outgoing (Phase 4)

| Email | Sent when | To | How |
|---|---|---|---|
| Missing documents | `api-document-checking` → `API_INCOMPLETE` | Customer (a fixed personal address for now; the IAS member-info email later) | A **new** email the first time; a reply in the same thread after that |
| Member issue | `api-member-verification` → `API_MEMBER_REVIEW_REQUIRED` | Internal (same recipient as email cases) | New email / reply in thread |
| Revision done | `api-claim-revision` → `API_CLAIM_REVISED` | Internal | New email |

- The jobs only **queue** an `EmailTask`. The shared `email-sender` sends it.
- **Every API email's subject contains the `tpaCaseNumber`.** This is how a reply can still be matched when the
  reply headers are missing.
- The first email creates the case's `ulink_email_threads` row and stores our outgoing `Message-ID` in
  `ulink_email_messages`. Replies are matched against that id.

### 7.2 Incoming: which case does an email belong to? (Phase 4)

There is **one inbox for both kinds of case** and **one reader**, `email-intake`. Neither workflow picks or skips
emails by type: every unread email is decided exactly once. For each email:

1. Skip it if it is already stored (`ulink_email_messages.source` + `externalId`).
2. Find its case (below). It belongs to exactly one case, API or email.
3. Store it and its attachments on that case.
4. Only then mark it `\Seen`. If step 2 or 3 fails, it stays unread and the next run retries it.

Never mark an email seen before it is stored, and never mark it seen for one case type while leaving it for the
other: both would lose or duplicate replies.

Finding the case:

```
1. In-Reply-To / References header matches an email we sent?
      → that email's thread → its case
2. else, subject contains the tpaCaseNumber of an API case?
      → that API case
3. else
      → new email case (existing behavior)
```

Then, if the matched case is an **API case**:

| API case status | Email has attachments | Result |
|---|---|---|
| `API_INCOMPLETE` or `API_MEMBER_REVIEW_REQUIRED` | yes | Store the email and attachments → **`API_REPLY_RECEIVED`** |
| `API_INCOMPLETE` or `API_MEMBER_REVIEW_REQUIRED` | no | Store the email; status unchanged |
| any other `API_*` | either | Store and log only; status unchanged |

Email cases keep their existing logic (`AWAITING_CUSTOMER_STATUSES` in `modules/email-intake/service.js`). The API
branch only ever writes `API_*` statuses, so a reply can't move an API case into the email pipeline.

**Known gap:** a customer who sends a brand-new email with a different subject becomes a new email case (rule 3).
An operator has to link it by hand.

## 8. Data

| Where | What | Written by | Read by |
|---|---|---|---|
| `ulink_cases` | Identity and status only: `source`, `claim_no`, `tpa_case_number`, `current_status` (later also `console_barcode`) | `api-claim-intake`, the runner (status) | every API job's selection, `email-intake` (subject match), console |
| `ulink_api_case_steps` | Every job run's `input` / `output` / `error` — **the data passed between jobs** | the runner (intake writes its own) | the runner (next job's input), console, debugging |
| `ulink_case_documents` | Case-level documents: console images (`origin='CONSOLE'`) | `api-material-download` | OCR (Phase 5), console (`GET /api/cases/:caseId/documents/:id`) |
| `ulink_email_*` | Emails and reply attachments (message level), same tables as email cases | `email-sender`, `email-intake` (Phase 4/6) | OCR (reply attachments) |
| `ulink_case_events` | Every status change | the runner, intake | console timeline |
| `ulink_job_checkpoints` | Per-job state not about one case: intake's `lastListedDate` | `api-claim-intake` | `api-claim-intake` |

## 9. Failure handling

Same conventions as the email jobs:

| Kind | Example | What the job does |
|---|---|---|
| Technical | Timeout, network error, non-2xx, disk error | Leave the case at its current status; the next run retries. Log the error |
| Business answer | IAS returns `success: false` for a revision | Move to a failed/review status; **don't retry** automatically |
| Waiting | Console images not uploaded yet | Leave the case as is. This is normal, not an error |
| Bad input row | IAS list row missing `clNo` | Skip and log that row; continue with the rest |

One case failing never stops the batch: each job handles errors per case.

## 10. Adding or changing an API job

1. Write the job as a runner job in `modules/api-<name>/service.js`: `{ name, inputStatus, inputs, batchLimit,
   process }`, exported with `run: () => runApiJob(job)`. `process` only uses its `input` (and the case's identity);
   reuse existing business rules from their modules instead of copying them.
2. `inputStatus` is an `API_*` status; `nextStatus` values are `API_*` statuses (the DB check rejects anything else).
3. Return the output the next job needs — keep it plain JSON; large data (files) goes in its own table/storage with
   ids in the output, like case documents.
4. Wire `POST /api/jobs/api-<name>/run` in `routes/jobs/index.js` via `createJobRouter`.
5. Add it to `API_STEPS` in `modules/pipeline/service.js`, then to `API_BLOCKS`/`API_EDGES` in the console's
   `graph/pipelineGraph.ts`; add new statuses to `KNOWN_STATUSES` (casesController) and the console labels.
6. Tests: `process` with a sample input (happy path, wait, failure), and the isolation tests still passing.
7. Update sections 4, 6 and 8 of this file.

## 11. Operating and debugging

Find an API case:

```sql
SELECT id, current_status, claim_no, tpa_case_number, updated_at
FROM ulink_cases
WHERE source = 'API' AND (claim_no = '2604050015' OR tpa_case_number = 'STEVENEVERHILLC58');
```

Its history:

```sql
SELECT created_at, block_name, prev_status, new_status, reason_code, message
FROM ulink_case_events WHERE case_id = '<id>' ORDER BY created_at;
```

What each job received and produced (the input → output chain):

```sql
SELECT created_at, job, status, input, output, error
FROM ulink_api_case_steps WHERE case_id = '<id>' ORDER BY created_at;
```

Its console images:

```sql
SELECT barcode_id, scan_id, original_filename, size_bytes, storage_ref
FROM ulink_case_documents WHERE case_id = '<id>' ORDER BY barcode_id, original_filename;
```

- **Run one step by hand:** `POST /api/jobs/<name>/run`.
- **A job is stuck as "already running"** after a crash: `POST /api/jobs/<name>/release`.
- **Reprocess a case:** `POST /api/dev/cases/reset` to an earlier `API_*` status. The DB check rejects a reset to
  an email status.
- **API case appears in the Email tab:** `source` is wrong, which rule 1 should make impossible. Investigate before
  fixing the data.
