# Jobs Registry

Catalog of every cron-triggered job in this project — what it does, its API, and
where it sits in the `Case.currentStatus` chain. Reference this when wiring the
eventual orchestrator (a single cron entry that calls each job's `run()` in
sequence, instead of one crontab line per job — see "Orchestrator" below).

Every job shares the same shape (`routes/jobs/createJobRouter.js` +
`controllers/job/jobsController.js`):
- `POST /api/jobs/<name>/run` — fire-and-forget, lock-guarded, returns
  `{ block, started: true }` or `{ block, skipped: true, reason: 'already_running' }`
  immediately; actual work happens in the background.
- `POST /api/jobs/<name>/release` — manually clears the lock if the process died
  mid-run.
- Selects its own batch of cases by `Case.currentStatus` — no direct
  job-to-job coupling. A job simply finds nothing to do until the case reaches
  the status it looks for.

---

## Built

| Job | Endpoint | Reads status | Writes status | Module |
|---|---|---|---|---|
| `email-intake` | `/api/jobs/email-intake/run` | — (reads new IMAP mail, not `Case` status) | `EMAIL_RECEIVED` → `ATTACHMENTS_STORED` → `READY_FOR_DOCUMENT_READING` | `modules/email-intake/service.js` |
| `claim-recognition` | `/api/jobs/claim-recognition/run` | `READY_FOR_DOCUMENT_READING` | `RECOGNIZED` / `NOT_RECOGNIZED` / `MANUAL_REVIEW` | `modules/claim-recognition/service.js`. Includes `applyMedicalRecordFallback()`: a confirmed false negative (a page explicitly headed "Medical Record Photos" in the source PDF still came back `medical_record.present: false` from the main synthesis call) gets one narrow, text-only re-ask, only when the main result says absent AND this template's own fixed label text ("Medical Record Photos" or, per jd2, "Medical Records") is actually present in a page transcript. Handles both real delivery shapes verified in the samples: embedded photo (complete/1, complete/2 — re-asks using that same page's transcript) and external link (jd2 — `findMedicalRecordFallbackChunk()` walks forward to the linked document's own transcript chunk instead, since the reference page itself only has the label + a bare URL). jd1's shape (no label at all near its medical-record link, only position) has no deterministic signal to key off and is left as a known, accepted gap. No manual-review escalation if the fallback also can't confirm one — the existing INCOMPLETE/resubmit-request flow is the backstop. |
| `member-verification` | `/api/jobs/member-verification/run` | `RECOGNIZED` **or** `MEMBER_REVIEW_REQUIRED` (the latter re-checked for recovery — see below; ordered by `updatedAt` so retries don't starve fresh cases) | `READY_FOR_DOCUMENT_CHECKING` / `MEMBER_REVIEW_REQUIRED` | Runs BEFORE `document-checking` as of 2026-09-01 (swapped per demo feedback — member/coverage eligibility checked first). Calls the IAS `GET_MEMBER_INFO_API` (`modules/member-verification/iasClient.js`, `AbortController`-timeout guarded) and runs Hard/Soft field comparisons (`modules/member-verification/checks.js`). Sets `Case.memberVerifyResult` (evaluated summary) and `Case.iasMemberInfoResponse` (raw IAS response verbatim — kept for the `ias-claim-creation` job, which needs fields off it like `MEPL_OID`/`PLAN_ID`/bank details without re-querying IAS). On pass, hands off to `document-checking` via `READY_FOR_DOCUMENT_CHECKING` — no email queued yet, since this is no longer the final gate. On `MEMBER_REVIEW_REQUIRED` (any reasonCode — `MEMBER_NOT_FOUND`, `COVERAGE_NOT_ACTIVE`, `MEMBER_DETAILS_MISMATCH`, `BANK_DETAILS_MISMATCH`), queues a customer-facing `MEMBER_VERIFY_ISSUE` `EmailTask` flagging the one line that reasonCode maps to (`REASON_CODE_TO_ISSUE` in `service.js`; `BANK_DETAILS_MISMATCH`'s line finally resolves the "Incorrect bank details" check `document-checking/checklist.js` deferred — two of the other three lines are placeholder wording, not from the approved canned-response doc, see `checklist.js`'s header comment). Deduped so a re-check that finds the same outcome doesn't re-queue. A technical failure (timeout, missing NRC/accident_date) leaves the case at its current status for retry, same as `document-checking`'s own per-case error handling. |
| `document-checking` | `/api/jobs/document-checking/run` | `READY_FOR_DOCUMENT_CHECKING` | `MEMBER_VERIFIED` / `INCOMPLETE` | Runs AFTER `member-verification` as of 2026-09-01 — now the last of the two checks, so it owns the real `MEMBER_VERIFIED` gate `ias-claim-preparation` reads (the outcome name is unrelated to which block sets it; it's kept as the literal DB value both before and after the swap). Pure code over `Case.extractedFields` (`modules/document-checking/checklist.js`), no external calls. Produces `Case.documentCheckResult.issues[]`. On pass, queues a `DOCUMENT_COMPLETE_ACK` `EmailTask` (both checks have now passed). On `INCOMPLETE`, queues a `MISSING_DOCUMENTS` `EmailTask` for `email-sender` (deduped by issue-set signature, so a re-check that finds the same problems doesn't re-queue). |
| `email-sender` | `/api/jobs/email-sender/run` | — (reads `ulink_email_tasks.status = PENDING`, not `Case.currentStatus` directly) | Flips its own task to `SENT`/`FAILED`; doesn't touch `Case.currentStatus` | Renders the task's template (`modules/email-sender/templates.js`) and sends via the channel adapter's `sendReply` (`channels/imapSmtpChannel.js`, SMTP — no longer a stub) as a reply in the case's existing thread, CC'd per the case's route (`Case.recognizedType` -> `ulink_claim_routes.cc_email`, null by default — set per route once a real internal address is known). Deliberately decoupled from `Case.currentStatus`: `member-verification`, `document-checking`, and `ias-claim-creation` are all producers, this is the one consumer, for `MEMBER_VERIFY_ISSUE`/`MISSING_DOCUMENTS`/`DOCUMENT_COMPLETE_ACK`/`CLAIM_CREATED_NOTIFICATION` task types. In the pipeline orchestrator (see "Orchestrator" below) this job runs twice per execution — once after `document-checking`, once after `ias-claim-creation` — so a notification queued by the last step still goes out the same run instead of waiting for the next tick. |
| `ias-claim-preparation` | `/api/jobs/ias-claim-preparation/run` | `MEMBER_VERIFIED` | `CLAIM_PAYLOAD_PREPARED` | Picks the best ICD-10 diagnosis code once per case (vector search in `modules/icd10/` + one LLM re-rank call, `modules/ias-claim-preparation/diagnosisPicker.js`), then builds **one `Items[]` line per real voucher** (`extractedFields.invoices.items[]` — verified against real sample data that a claim can genuinely be multiple separate vouchers, e.g. a consultation receipt + a separate pharmacy receipt), each with its own subtotal and its own BenefitType/BenefitHead pick against the member's own plan's valid combinations (`modules/ias-claim-preparation/benefitPicker.js`, using that voucher's own `voucher_type` — `consultation`/`pharmacy`/`lab`/`optical`/`other`, extracted by `claim-recognition` from what's visibly printed on it — as the strongest signal). Builds the full `CL_CLAIM_API` request payload (`modules/ias-claim-preparation/payloadBuilder.js`, verified against the real sample in `docs/imp/day1/IAS/ias_claim_submission_api.json`). Sets `Case.iasClaimPayload`. A diagnosis/benefit pick that comes back `null` does not block preparation — that line's fields stay null; that's IAS's own validation to catch, not pre-empted here. Technical failure leaves the case at `MEMBER_VERIFIED` for retry. Cases recognized before `voucher_type` existed won't have it — need reprocessing via `claim-recognition` to get accurate per-line benefit picks. |
| `ias-claim-creation` | `/api/jobs/ias-claim-creation/run` | `CLAIM_PAYLOAD_PREPARED` | `CLAIM_CREATED` / `CLAIM_SUBMIT_FAILED` | Submits `Case.iasClaimPayload` to the real IAS `CL_CLAIM_API` (`modules/ias-claim-creation/iasClaimClient.js` — same `AbortController`-timeout shape as every other external call here). Fully automatic, no approval gate (confirmed). Splits failure by *kind*, not just success/failure: a technical failure (network error, timeout, non-2xx status) throws and is left un-caught by `checkCase`, so `run()`'s per-case try/catch leaves the case at `CLAIM_PAYLOAD_PREPARED` for retry next run — same recovery pattern as every other job. A real business answer from IAS (`{success: true, ...}` or `{success: false, error: "..."}`, e.g. "Claim already exists") is a normal return value, not a thrown error: `success: true` sets `Case.claimNo`/`Case.iasClaimResult`, moves to `CLAIM_CREATED`, and queues a `CLAIM_CREATED_NOTIFICATION` `EmailTask` (deduped, sent in-thread like the other two task types); `success: false` moves to `CLAIM_SUBMIT_FAILED` with the error stored in `Case.iasClaimResult` and is **not retried** — a definitive rejection, not a transient failure. |

**Supporting infrastructure (not a job — no `Case.currentStatus`, no cron trigger):**
- `modules/icd10/` — ICD-10 diagnosis vector search used by `ias-claim-preparation`.
  `scripts/ingestIcd10Diagnoses.js` is a one-off manual data load (~39,793 rows from
  `docs/imp/day1/IAS_RAG/DIAG_CLASS_ICD10_2012_STAGING.xlsx`), not a recurring job.
  Deliberately uses **exact** (sequential-scan) nearest-neighbor search, no vector index —
  the HNSW index this table originally had gave verifiably wrong top-K results (see
  `db/migrations/20260823190000-drop-icd10-hnsw-index.js`); since this runs once per case
  in a background batch job, the ~7-10s exact-scan cost is a fine trade for guaranteed
  correctness.

**Dev-only tools** (not cron jobs, not part of the orchestrator):
- `POST /api/dev/claim-recognition/:caseId/preview` — zero persistence.
- `POST /api/dev/document-checking/:caseId/preview` — zero persistence, no external call.
- `POST /api/dev/member-verification/:caseId/preview` — real IAS call, zero persistence.
- `POST /api/dev/email-sender/:caseId/preview` — renders a pending task's email, no SMTP call, zero persistence.
- `POST /api/dev/icd10/lookup` — nearest-neighbor ICD-10 candidates for arbitrary text, zero persistence.
- `POST /api/dev/ias-claim-preparation/:caseId/preview` — real LLM calls, zero persistence.
- `POST /api/dev/ias-claim-creation/:caseId/preview` — **NOT a dry run**: calls the real IAS `CL_CLAIM_API` and persists exactly like the real job (`Case.currentStatus`/`claimNo`/`iasClaimResult`, queues `CLAIM_CREATED_NOTIFICATION` on success). There is no confirmed "validate without creating" mode in IAS, so a success here creates a real claim. Only call against a case you intend to actually submit.
- `POST /api/dev/cases/reset` — rewinds a case to an earlier status for reprocessing.

---

## Orchestrator

Single cron entry instead of one per job (`modules/pipeline/service.js`'s
`STEPS`, exposed as `POST /api/jobs/pipeline/run`) — each job still stays its
own small, independently-testable module; only the *scheduling* is
consolidated:

```
POST /api/jobs/pipeline/run   ← the only crontab line
  → email-intake.run()
  → claim-recognition.run()
  → member-verification.run()      ← swapped before document-checking, 2026-09-01 (demo feedback)
  → document-checking.run()        ← now the last check; owns the final MEMBER_VERIFIED gate
  → email-sender.run()             ← catches member-verification's and document-checking's tasks
  → ias-claim-preparation.run()
  → ias-claim-creation.run()
  → email-sender.run()            ← catches ias-claim-creation's CLAIM_CREATED_NOTIFICATION, same run
```

Order matters here because each job reads the status the previous one writes —
but since every job filters by `Case.currentStatus` internally, a case that
`claim-recognition` just moved to `RECOGNIZED` earlier in the *same* tick is
already visible to `member-verification` right after (same DB, read-after-write).
Branching (`INCOMPLETE` vs `MEMBER_VERIFIED` vs `CLAIM_CREATED`) is handled
naturally by each job's own status filter, not by orchestrator control flow —
the orchestrator itself has no branching logic, it just calls every job's
`run()` every tick and each one no-ops if there's nothing at its stage.
`email-sender` is the one exception: it filters by `ulink_email_tasks.status`,
not `Case.currentStatus`, since it's a shared consumer for tasks queued by
three different producers (`member-verification`, `document-checking`, and
`ias-claim-creation`) — and it's the one job that appears twice in the list
above, since `ias-claim-creation` (the last status-chain step) queues its own
task *after* the first `email-sender` call already ran; without the second
call, a `CLAIM_CREATED_NOTIFICATION` would sit `PENDING` until the next tick.

Note that `MEMBER_VERIFIED` as a literal `Case.currentStatus` value is
unchanged by the swap — it's still the one status `ias-claim-preparation`
reads, and it still means "both checks passed". Only *which* job sets it
changed: `document-checking` sets it now (it's the last of the two checks),
not `member-verification`. `member-verification`'s own internal pass outcome
is still literally named `MEMBER_VERIFIED` too (see `checks.js`), but that
name describes what that block concluded, not the `Case.currentStatus` it
writes — a pass there now writes `READY_FOR_DOCUMENT_CHECKING` instead, so
`ias-claim-preparation` can't pick a case up before `document-checking` has
actually run it. See `modules/member-verification/service.js`'s
`OUTCOME_TO_STATUS` and `modules/document-checking/service.js`'s own
`OUTCOME_TO_STATUS` for exactly where that mapping happens.

Each job's individual `/api/jobs/<name>/run` endpoint stays live even after the
orchestrator exists — useful for manually re-running or debugging one stage in
isolation without kicking off the whole pipeline.

---

## Maintenance

Add a row here (Built or Planned) whenever a new job is designed or built —
keep the status-chain columns accurate, since that's what the orchestrator
section depends on being correct.
