# ULINK STP — Email Submission Recognition Module

Date: 2026-08-21

## Purpose

This document scopes and designs the first buildable module: **Email Submission Recognition**, item 1 of the DRT sample-case task list:

```text
1) Email submission recognization
2) Document checking and member verification
3) Identify missing document
4) Draft email and request for the missing document
5) Send to Ulink's email
6) For complete case to create claim number in iAS
```

"Recognition" is not just receiving an email. Per the Lego Block Architecture's Important Intake Rule, we are not allowed to decide *what an email is* from subject/body/filename — only from document content. So this module must go all the way to a content-based scope decision. It maps to four Lego blocks from `ULINK_STP_Lego_Block_Architecture.md`:

```text
Email Intake -> Document Reader -> Document Classifier -> Claim Scope Classifier
```

Everything after this (JD1 completeness checks, missing-doc email, JD2, iAS claim creation — DRT steps 2–6) is explicitly **out of scope** for this module and must not be implemented here.

## Module Boundary

**In scope — this module answers one question:** *"Is this email thread a supported claim submission (AYAS member reimbursement), and if so, what documents/text do we have for it?"*

**Terminal outputs of this module (nothing further happens here):**

- `SUPPORTED_CLAIM_SUBMISSION` — case matched `ayas_member_reimbursement` profile, hand off to JD1.
- `UNSUPPORTED_EMAIL_TYPE` — not a claim submission, or an insurer/claim type we don't support yet.
- `CLASSIFICATION_MANUAL_REVIEW` — ambiguous, low-confidence, or unreadable; a human decides.

**Explicitly not built here:** document-completeness checks, field-level mismatch detection, missing-document email drafting/sending, Console upload, iAS lookups, claim API. Those consume this module's output but live in later modules.

## Process Flow

Each block below is **not** a chained in-process call. Each is its own HTTP job-trigger endpoint, invoked independently by its own crontab entry. A block's job queries the DB for rows in the right pending state, processes a batch, and updates state — it never calls another block's code directly. This is the decoupling confirmed for this module: intake is cron-triggered, and classification runs as its own separately-scheduled job rather than inline during mail reading.

```text
crontab (intake schedule)              crontab (reader schedule)
   │                                        │
   ▼                                        ▼
POST /api/jobs/email-intake/run        POST /api/jobs/document-reader/run
[1] Email Intake                       [2] Document Reader
   - fetch new IMAP message(s)            - pick up attachments pending read
   - match/create email_thread + case     - extract text (PDF text layer) or OCR
     (headers + fallback identifiers)     - convert image -> PDF where needed
   - persist email_message                - persist document + document_text
   - download + persist email_attachment  - emit DOCUMENT_TEXT_EXTRACTED /
     (raw bytes via storage adapter)         DOCUMENT_READING_FAILED /
   - emit EMAIL_RECEIVED /                  DOCUMENT_NEEDS_MANUAL_REVIEW
     ATTACHMENTS_STORED /
     READY_FOR_DOCUMENT_READING

crontab (classifier schedule)          crontab (scope schedule)
   │                                        │
   ▼                                        ▼
POST /api/jobs/document-classifier/run POST /api/jobs/claim-scope-classifier/run
[3] Document Classifier                [4] Claim Scope Classifier
   - LM Studio prompt over                - pick up cases whose attachments have
     document_text only (no filename/       ALL reached a terminal per-document
     subject/body)                          state (DOCUMENT_CLASSIFIED or
   - classify into: CLAIM_NOTIFICATION |    DOCUMENT_READING_FAILED)
     E_CLAIM_SUBMISSION | MEDICAL_REPORT |  - detect insurer + channel + claim_type
     VOUCHER_INVOICE_RECEIPT |                from classified doc content
     BANK_INFORMATION | DELEGATION_LETTER |  - match against stp_profiles config
     APPROVAL | PROPOSAL | KYC | UNKNOWN    - persist classification_result
   - persist document_classification       - emit SUPPORTED_CLAIM_SUBMISSION /
   - emit DOCUMENT_CLASSIFIED /               UNSUPPORTED_EMAIL_TYPE (-> manual
     DOCUMENT_CLASSIFICATION_UNCERTAIN         review queue) /
                                               CLASSIFICATION_MANUAL_REVIEW
                                        │
                                        ▼
                              Handoff to JD1 module (out of scope here)
```

There is no in-process debounce timer for "have all attachments arrived yet" — the Claim Scope Classifier job's own periodic cadence (its cron interval) is the debounce. On each run it only picks up cases where every known attachment has already reached a terminal per-document state; a case with attachments still mid-processing simply isn't picked up until the next tick.

Because every job is retried by re-triggering its endpoint, a stuck OCR run must not block the next email-intake tick — they are fully independent schedules.

## Job / Trigger Model

- Every block is exposed as `POST /api/jobs/<block-name>/run`. Body/response is minimal (e.g. `{ processed: N, errors: [...] }`) — the real state lives in the DB, not in the response.
- Scheduling lives outside the app: OS-level crontab (or hosting platform's scheduler) hits each endpoint on its own interval. The app has no internal scheduler/IDLE connection for Day 1.
- **No auth on these endpoints for Day 1** — assumes cron and app run on the same trusted host/network. Revisit (shared-secret header) before the app is reachable from anywhere untrusted.
- **Overlap protection:** each job type gets a lock row (`workflow_jobs` or a small `job_locks` table) with a `running` flag + `started_at`. On trigger: if already `running`, return immediately without doing work (log it, don't error loudly). On completion (success or failure), clear the flag. A stale lock (crashed process) should be recoverable via a max-age timeout, but that's a Day 2 concern, not required to ship Day 1.
- Per-block schedule intervals (e.g. intake every 2 min, reader every 2 min, classifier every 5 min, scope every 5 min) are a tuning question once real traffic volume is known — start conservative and adjust.

## Sub-Modules

### 1. Email Intake

- **Responsibility:** read mailbox, store thread/message/attachments, match/create case. No business decision.
- **Input:** IMAP connection; new message UID.
- **Output:** `email_thread`, `email_message`, `email_attachment` rows; `case` row if new.
- **Thread/case matching order** (per Workflow Implementation Summary):
  1. `Message-ID` / `In-Reply-To` / `References` header match against known `email_messages`.
  2. Fallback: extracted claim identifiers already known on an open case — policy number, claimant name, NRC/passport, case/claim number, sender email — only usable once documents from this thread have already been read once; first message in a thread has nothing to fall back on but headers.
- **Events:** `EMAIL_RECEIVED`, `ATTACHMENTS_STORED`, `READY_FOR_DOCUMENT_READING`.
- **Trigger:** `POST /api/jobs/email-intake/run`, called by crontab.
- **Notes:** dedupe by IMAP UID + `Message-ID` so re-polling never double-inserts. Attachment bytes go through a storage adapter (see below) — Day 1 writes to local disk; the DB row stores a storage key/ref, never the bytes.

### 2. Document Reader

- **Responsibility:** turn each attachment into text. No classification decision.
- **Input:** `email_attachment_id`.
- **Output:** `document`, `document_text`, extraction metadata (method: `pdf_text` | `ocr`, confidence, page count).
- **Events:** `DOCUMENT_TEXT_EXTRACTED`, `DOCUMENT_READING_FAILED`, `DOCUMENT_NEEDS_MANUAL_REVIEW`.
- **Trigger:** `POST /api/jobs/document-reader/run`, called by crontab. Picks up attachments still in `READY_FOR_DOCUMENT_READING`.
- **Notes:** JPG/PNG converted to PDF here (needed later for Console upload, per the "Console Upload Assumptions" doc) even though Console upload itself is out of scope for this module.

### 3. Document Classifier

- **Responsibility:** classify document type from `document_text` only.
- **Input:** `document_id` + extracted text.
- **Output:** document type, confidence, evidence snippet.
- **Events:** `DOCUMENT_CLASSIFIED`, `DOCUMENT_CLASSIFICATION_UNCERTAIN`.
- **Trigger:** `POST /api/jobs/document-classifier/run`, called by crontab. Picks up documents with text extracted but not yet classified.
- **Notes:** low-confidence result does not fail the pipeline — it flows into Claim Scope Classifier as `UNKNOWN` and can still tip the case into `CLASSIFICATION_MANUAL_REVIEW`.

### 4. Claim Scope Classifier

- **Responsibility:** decide whether the case is a supported STP profile.
- **Input:** case's classified documents + extracted text.
- **Output:** matched `stp_profiles` key, or unsupported reason.
- **Events:** `SUPPORTED_CLAIM_SUBMISSION`, `UNSUPPORTED_EMAIL_TYPE`, `CLASSIFICATION_MANUAL_REVIEW`.
- **Day-1 rule:** only `ayas_member_reimbursement` is enabled; everything else resolves to `UNSUPPORTED_EMAIL_TYPE` (not an error — just not this pipeline's job yet).
- **Trigger:** `POST /api/jobs/claim-scope-classifier/run`, called by crontab, on its own schedule (separate from the reader/classifier jobs, per confirmed decision).
- **"Ready to classify" rule:** each run picks up cases where every known attachment has reached a terminal per-document state (`DOCUMENT_CLASSIFIED` or `DOCUMENT_READING_FAILED`) and the case hasn't been scope-classified yet. No timer/debounce needed — the job's own cron cadence is the wait.
- **`UNSUPPORTED_EMAIL_TYPE` handling (confirmed):** routes into the same manual-review queue as `CLASSIFICATION_MANUAL_REVIEW` rather than being silently stored — a human periodically confirms it wasn't a misclassified real claim.

## Storage Adapter (attachments/documents)

Confirmed: local disk for Day 1, but built behind a small interface so S3 or Supabase Storage can be swapped in later without touching calling code.

```js
// storage/index.js
interface StorageAdapter {
  put(key: string, bytes: Buffer): Promise<{ storageRef: string }>;
  get(storageRef: string): Promise<Buffer>;
}
```

- Day 1 implementation: `storage/localDiskAdapter.js` — writes under a configured root (e.g. `STORAGE_ROOT=./data/attachments`), `storageRef` is the relative path.
- Every DB row that references a file (`email_attachments.storage_ref`, `documents.storage_ref`) stores only the adapter-agnostic `storageRef` string, never a raw filesystem path assumption — so switching adapters later is a config change (`STORAGE_DRIVER=local|s3|supabase`), not a schema or call-site change.
- Do not build the S3/Supabase adapters now — just keep the interface real (used by intake/reader code) so adding them later is additive.

## Data Model (this module's slice)

All tables are prefixed `ulink_` — confirmed decision, since `SUPABASE_DB_CONN_STR` points to a **shared Supabase database that already holds an unrelated PO/invoice/logistics system's tables** (factories, ship-to codes, PO items, invoices, package lists, etc. — discovered via `sequelize-cli db:migrate:status` showing ~24 pre-existing migrations). The prefix keeps this project's tables clearly namespaced and collision-free in that shared database.

```text
ulink_cases                      -- id, current_status, stp_profile, created_at, updated_at
ulink_email_threads               -- id, case_id, subject_hint(audit only), first_message_id, created_at
ulink_email_messages               -- id, thread_id, message_id, in_reply_to, references_header, from_addr, received_at, created_at
ulink_email_attachments            -- id, message_id, storage_ref, original_filename(audit only), content_type, created_at
ulink_documents                    -- id, attachment_id, storage_ref(pdf if converted), status, created_at
ulink_document_texts                -- id, document_id, text, extraction_method, extraction_confidence, created_at
ulink_document_classifications      -- id, document_id, doc_type, confidence, evidence, created_at
ulink_classification_results        -- id, case_id, matched_profile, result, reason_code, created_at
ulink_workflow_jobs                  -- id, case_id, block_name, status, retry_count, last_error, created_at, updated_at
ulink_job_locks                       -- block_name (pk), running (bool), started_at
ulink_case_events                   -- id, case_id, block_name, prev_status, new_status, reason_code, message, raw_ref, created_at
ulink_manual_review_queue            -- id, case_id, reason_code (UNSUPPORTED_EMAIL_TYPE | CLASSIFICATION_MANUAL_REVIEW | ...), created_at, resolved_at
```

`original_filename` / `subject_hint` are stored **for audit/display only** — never read by classification code. Worth a lint rule or code-review checklist item so this doesn't quietly get violated later.

`ulink_job_locks` is the overlap-protection table: one row per block, `running=true` while a trigger is mid-execution, cleared on completion (success or failure). A trigger that finds `running=true` returns immediately without doing work.

**ORM/migrations (confirmed decision, 2026-08-21):** Sequelize, not raw `pg` + hand-written SQL. Migration lives at `db/migrations/20260821120000-create-email-submission-recognition-tables.js` (via `queryInterface`); models live under `db/models/` (one Sequelize model per table, associations wired in `db/models/index.js`). Service code uses model methods (`findAll`/`create`/`update`/`transaction`) for normal CRUD; the two genuinely complex multi-table anti-join queries (Document Reader's "attachments missing a document row," Claim Scope Classifier's "case ready to scope-classify") stay as raw SQL via `sequelize.query()` — still Sequelize's connection/pool, just not the high-level query builder, which is the standard escape hatch for queries the ORM's builder can't express cleanly. **Not yet applied**: the migration has not been run against the real database — the user will run `npm run db:migrate` themselves.

## Config (reused from Lego Block doc, unchanged)

```yaml
stp_profiles:
  ayas_member_reimbursement:
    enabled: true
    insurer: AYAS
    claim_channel: member
    claim_type: reimbursement
    classification:
      use_email_subject: false
      use_email_body: false
      use_attachment_filename: false
      evidence_source: document_content
```

This module reads `classification.*` to enforce the intake rule programmatically, not just by convention.

## State Subset for This Module

```text
EMAIL_RECEIVED
READY_FOR_DOCUMENT_READING
DOCUMENT_READING
READY_FOR_CLASSIFICATION
CLASSIFYING
SUPPORTED_CLAIM_SUBMISSION   -> handoff to JD1 module
UNSUPPORTED_SCOPE
CLASSIFICATION_MANUAL_REVIEW
FAILED_RETRYABLE
FAILED_NON_RETRYABLE
```

## Suggested Code Layout (inside existing `ulink-admin/src/ulink-api`)

The Express scaffold already has `config/`, `middlewares/`, `routes/`, `utils/`. Add a `modules/` tree so each Lego block stays independently testable/replaceable:

Built (as of 2026-08-21):

```text
src/ulink-api/
  modules/
    email-intake/
      imapClient.js       -- ImapFlow wrapper, marks \Seen only after persist succeeds
      threadMatcher.js     -- header-based thread/case match+create
      service.js
    document-reader/
      rasterize.js         -- pdftoppm (PDF->JPEG pages) + sharp (image normalize)
      service.js            -- rasterize -> llm.transcribeImagesToText -> document_texts
    document-classifier/
      prompts/system-prompt.md
      service.js            -- text-only LLM call -> document_classifications
    claim-scope-classifier/
      prompts/system-prompt.md
      profileMatcher.js     -- deterministic match against enabled stp_profiles
      service.js            -- "ready to classify" query -> LLM -> classification_results
  llm/
    client.js               -- shared LM Studio client: transcribeImagesToText (vision),
                                requestJsonCompletion (text, JSON-schema), used by both
                                document-reader and document-classifier/claim-scope-classifier
  storage/
    index.js                -- StorageAdapter interface + driver factory
    localDiskAdapter.js
  db/
    models/
      index.js               -- Sequelize bootstrap: loads config/database.js, wires associations
      case.js, emailThread.js, emailMessage.js, emailAttachment.js,
      document.js, documentText.js, documentClassification.js,
      classificationResult.js, workflowJob.js, jobLock.js,
      caseEvent.js, manualReviewQueue.js
    migrations/
      20260821120000-create-email-submission-recognition-tables.js
  config/database.js         -- sequelize-cli config (separate from config/index.js)
  .sequelizerc
  jobs/
    jobLock.js              -- acquire/release per block_name (job_locks table)
  routes/
    jobs/
      createJobRouter.js    -- shared POST /run handler: lock -> service.run() -> unlock
      index.js               -- mounts /api/jobs/{email-intake,document-reader,
                                 document-classifier,claim-scope-classifier}/run
  config/
    stpProfiles.yaml
    stpProfiles.js
```

`llm/client.js` is a shared stateless utility (not decision logic), used by three of the four blocks — this doesn't violate Lego separation since each block still owns its own prompt, schema, and DB writes.

Each `routes/jobs/*` handler: checks `job_locks` via `jobLock.acquire()`, calls its module's `service.run()`, releases the lock in `finally`, returns `{ processed, errors }` (or `{ skipped: true }` if already running). Each `service.js` exposes the same shape: query-for-pending -> process -> persist + `case_events` -> return summary, and never calls another block's service directly — only through DB status that the next block's own cron-triggered query picks up. That keeps blocks swappable per the core principle in the Lego doc, and matches the confirmed cron-per-block model.

Not yet run: `db/migrations/0001_email_submission_recognition.sql` has not been applied to the real Supabase database — apply it (via the Supabase SQL editor or `psql "$SUPABASE_DB_CONN_STR" -f db/migrations/0001_email_submission_recognition.sql`) once `.env` is filled in, before triggering any job endpoint.

Note: `ulink-is-ai` (the earlier demo) already has IMAP/SMTP libraries (`imapflow`, `mailparser`, `nodemailer`) installed and can be referenced for **library choice**, but per prior guidance its intake/classification logic itself should not be reused wholesale — ulink-admin's intake rule (content-only classification, config-driven profile) is stricter than the demo's.

## Build Order (mirrors Day 1 Milestones 1–4)

1. Email Storage Only — IMAP reader, thread/message/attachment tables, case creation, event logging. No classification.
2. Document Reading — text/OCR extraction pipeline, error/status logging. No classification.
3. Document Classification — LM Studio prompt, confidence storage, manual-review path.
4. Scope Classification — config-driven profile match, supported/unsupported/manual-review result.

Stop here and validate against the sample cases (Hlaing Myo Oo, Moe Thida, Shin Minn Thi, U Than Myint Soe, Khin Maung) before starting JD1. All five should reach `SUPPORTED_CLAIM_SUBMISSION` at this stage — none of them are scope failures, they only diverge later at JD1/JD2. That's a good regression check: if this module ever routes one of them to `UNSUPPORTED_EMAIL_TYPE`, something in intake/classification broke, not JD1/JD2.

## Confirmed Decisions (2026-08-21)

| Area | Decision |
| --- | --- |
| Attachment storage | Local disk for Day 1, behind a `StorageAdapter` interface so S3/Supabase Storage can be added later without call-site changes. |
| Mailbox watching | No IMAP IDLE, no in-app scheduler. Each block is its own `POST /api/jobs/<block>/run` endpoint, triggered externally by crontab. |
| Classification timing | Claim Scope Classifier runs as its own separately-scheduled job, not inline during mail reading — its cron cadence replaces the debounce-timer idea. |
| Unsupported emails | `UNSUPPORTED_EMAIL_TYPE` routes into the manual-review queue (same as `CLASSIFICATION_MANUAL_REVIEW`), not silent-only storage. |
| Job endpoint auth | None for Day 1 (trusted host/network assumption). Add a shared-secret header before the app is reachable from anywhere untrusted. |
| Overlap handling | Skip-if-already-running via a `job_locks` row per block; no queueing/backoff needed yet. |

## Open Questions Still Needed

1. Mailbox credentials/address for IMAP (Outlook) — host, port, folder(s) to poll, auth method (basic/app-password/OAuth).
2. Per-block cron interval to start with (e.g. intake every 2 min, reader every 2 min, classifier every 5 min, scope every 5 min) — a starting guess to tune once real traffic is seen.
3. Local disk root path/convention for `STORAGE_ROOT` in dev vs wherever this eventually deploys.
