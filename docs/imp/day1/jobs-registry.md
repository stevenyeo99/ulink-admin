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
| `claim-recognition` | `/api/jobs/claim-recognition/run` | `READY_FOR_DOCUMENT_READING` | `RECOGNIZED` / `NOT_RECOGNIZED` / `MANUAL_REVIEW` | `modules/claim-recognition/service.js` |
| `document-checking` | `/api/jobs/document-checking/run` | `RECOGNIZED` | `DOCUMENT_CHECKED` / `INCOMPLETE` | Pure code over `Case.extractedFields` (`modules/document-checking/checklist.js`), no external calls. Produces `Case.documentCheckResult.issues[]`. On `INCOMPLETE`, also queues a `MISSING_DOCUMENTS` `EmailTask` for `email-sender` (deduped by issue-set signature, so a re-check that finds the same problems doesn't re-queue). |
| `member-verification` | `/api/jobs/member-verification/run` | `DOCUMENT_CHECKED` **or** `MEMBER_REVIEW_REQUIRED` (the latter re-checked for recovery — see below; ordered by `updatedAt` so retries don't starve fresh cases) | `MEMBER_VERIFIED` / `MEMBER_REVIEW_REQUIRED` | Calls the IAS `GET_MEMBER_INFO_API` (`modules/member-verification/iasClient.js`, `AbortController`-timeout guarded) and runs Hard/Soft field comparisons (`modules/member-verification/checks.js`). Sets `Case.memberVerifyResult` (evaluated summary) and `Case.iasMemberInfoResponse` (raw IAS response verbatim — kept for the planned `ias-claim-creation` job, which needs fields off it like `MEPL_OID`/`PLAN_ID`/bank details without re-querying IAS). On `MEMBER_VERIFIED`, queues a `DOCUMENT_COMPLETE_ACK` `EmailTask`. On `MEMBER_REVIEW_REQUIRED` (any reasonCode — `MEMBER_NOT_FOUND`, `COVERAGE_NOT_ACTIVE`, `MEMBER_DETAILS_MISMATCH`, `BANK_DETAILS_MISMATCH`), queues a customer-facing `MISSING_DOCUMENTS` `EmailTask` flagging the one line that reasonCode maps to (`REASON_CODE_TO_ISSUE` in `service.js`; `BANK_DETAILS_MISMATCH`'s line finally resolves the "Incorrect bank details" check `document-checking/checklist.js` deferred — two of the other three lines are placeholder wording, not from the approved canned-response doc, see `checklist.js`'s header comment). Deduped so a re-check that finds the same outcome doesn't re-queue. A technical failure (timeout, missing NRC/accident_date) leaves the case at its current status for retry, same as `document-checking`'s own per-case error handling. |
| `email-sender` | `/api/jobs/email-sender/run` | — (reads `ulink_email_tasks.status = PENDING`, not `Case.currentStatus` directly) | Flips its own task to `SENT`/`FAILED`; doesn't touch `Case.currentStatus` | Renders the task's template (`modules/email-sender/templates.js`) and sends via the channel adapter's `sendReply` (`channels/imapSmtpChannel.js`, SMTP — no longer a stub) as a reply in the case's existing thread. Deliberately decoupled from `Case.currentStatus`: both `document-checking` and `member-verification` are producers, this is the one consumer, always for `MISSING_DOCUMENTS`/`DOCUMENT_COMPLETE_ACK` task types. |

**Dev-only tools** (not cron jobs, not part of the orchestrator):
- `POST /api/dev/claim-recognition/:caseId/preview` — zero persistence.
- `POST /api/dev/document-checking/:caseId/preview` — zero persistence, no external call.
- `POST /api/dev/member-verification/:caseId/preview` — real IAS call, zero persistence.
- `POST /api/dev/email-sender/:caseId/preview` — renders a pending task's email, no SMTP call, zero persistence.
- `POST /api/dev/cases/reset` — rewinds a case to an earlier status for reprocessing.

---

## Planned (not built yet)

| Job | Reads status | Writes status | Notes |
|---|---|---|---|
| `ias-claim-creation` | `MEMBER_VERIFIED` | `CLAIM_CREATED` | Calls IAS `CL_CLAIM_API` (`postClaimSubmission`-equivalent, reference: `ulink-is-ai/src/services/iasService.js`). The "happy path" branch — only cases that passed both document-checking and member-verification reach this status. |

---

## Orchestrator (not built yet)

Single cron entry instead of one per job — each job still stays its own small,
independently-testable module; only the *scheduling* is consolidated:

```
POST /api/jobs/pipeline/run   ← the only crontab line
  → email-intake.run()
  → claim-recognition.run()
  → document-checking.run()
  → member-verification.run()
  → email-sender.run()
  → ias-claim-creation.run()
```

Order matters here because each job reads the status the previous one writes —
but since every job filters by `Case.currentStatus` internally, a case that
`claim-recognition` just moved to `RECOGNIZED` earlier in the *same* tick is
already visible to `document-checking` right after (same DB, read-after-write).
Branching (`INCOMPLETE` vs `MEMBER_VERIFIED` vs `CLAIM_CREATED`) is handled
naturally by each job's own status filter, not by orchestrator control flow —
the orchestrator itself has no branching logic, it just calls every job's
`run()` every tick and each one no-ops if there's nothing at its stage.
`email-sender` is the one exception: it filters by `ulink_email_tasks.status`,
not `Case.currentStatus`, since it's a shared consumer for tasks queued by two
different producers (`document-checking` and `member-verification`).

Each job's individual `/api/jobs/<name>/run` endpoint stays live even after the
orchestrator exists — useful for manually re-running or debugging one stage in
isolation without kicking off the whole pipeline.

---

## Maintenance

Add a row here (Built or Planned) whenever a new job is designed or built —
keep the status-chain columns accurate, since that's what the orchestrator
section depends on being correct.
