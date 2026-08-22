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

**Dev-only tool** (not a cron job, not part of the orchestrator):
`POST /api/dev/claim-recognition/:caseId/preview` — runs `claim-recognition`'s
logic for one case with zero persistence, for manual QA.

---

## Planned (not built yet)

| Job | Reads status | Writes status | Notes |
|---|---|---|---|
| `document-checking` | `RECOGNIZED` | `DOCUMENT_CHECKED` / `INCOMPLETE` | Pure code over `Case.extractedFields`, no external calls. Produces `Case.documentCheckResult.issues[]` (see `drt-claim-demo-progress.md`). |
| `member-verification` | `DOCUMENT_CHECKED` (only cases that already passed document checks — no reason to spend an IAS call on a known-incomplete claim) | `MEMBER_VERIFIED` / `MEMBER_REVIEW_REQUIRED` | Calls the IAS `GET_MEMBER_INFO_API`. Needs the same timeout/error discipline as `imapClient.js` — external call, must not be able to hang the job. |
| `missing-document-notification` | `INCOMPLETE` / `MEMBER_REVIEW_REQUIRED` | e.g. `MISSING_DOC_REQUEST_SENT` | Drafts + sends the checklist email (real template already captured in `drt-claim-demo-progress.md`) to Ulink's inbox. Blocked on `channels/imapSmtpChannel.js::sendReply()`, currently a stub. |
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
  → missing-document-notification.run()
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

Each job's individual `/api/jobs/<name>/run` endpoint stays live even after the
orchestrator exists — useful for manually re-running or debugging one stage in
isolation without kicking off the whole pipeline.

---

## Maintenance

Add a row here (Built or Planned) whenever a new job is designed or built —
keep the status-chain columns accurate, since that's what the orchestrator
section depends on being correct.
