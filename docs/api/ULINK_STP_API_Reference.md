# ULINK STP — REST API Reference (Day 1)

Base URL: `http://<host>:<port>` (see `PORT` in `.env`)
Content-Type: `application/json` for all responses.
Auth: **none**. Day 1 assumes a trusted host/network. Add a shared-secret
header on `/api/jobs/*` before exposing this API externally.

Mounted routers (`app.js`):

| Path prefix   | Router                          |
|----------------|----------------------------------|
| `/`            | `routes/meta/root.js`            |
| `/health`      | `routes/meta/health.js`          |
| `/api/users`   | `routes/users/index.js` (scaffold) |
| `/api/jobs`    | `routes/jobs/index.js`           |
| `/api/docs`    | Swagger UI (`openapi/spec.js`)   |

---

## GET /

Service identity check.

**Response 200**
```json
{ "name": "ulink-api", "message": "Welcome to ULINK API" }
```

---

## GET /health

Liveness probe.

**Response 200**
```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-08-22T03:00:00.000Z"
}
```

---

## GET /api/users

Scaffold route, not wired to a real module yet (`routes/api/users.js`). Returns
a static empty payload — replace when a Users module exists.

**Response 200**
```json
{ "data": [] }
```

---

## Jobs API — `/api/jobs/<blockName>`

Generic runner (`routes/jobs/createJobRouter.js` + `controllers/job/jobsController.js`)
used to trigger a pipeline block's `run()` from an external cron
(crontab `curl -X POST ...`), one router instance per block. Every block gets
the same two endpoints.

### POST /api/jobs/:blockName/run

**Fire-and-forget.** Acquires the job lock and returns immediately — the
actual batch runs in the background *after* the response is sent, so a slow
or stuck downstream call (IMAP, DB) can never hang this request. The result
(processed count, per-message errors) is **not** in the response — check
server logs (`logger.info`/`logger.error` on completion) or the case data
itself (`CaseEvent` rows, `Case.currentStatus`) for the outcome. Guarded by a
Postgres-backed lock (`ulink_job_locks`, `jobs/jobLock.js`) so overlapping
cron triggers for the same block skip instead of running concurrently — no
request body.

**Currently registered blocks**: `email-intake`, `claim-recognition` (see
below for both). Other blocks (document-reader, document-classifier) are out
of scope for the current build phase and not mounted.

**Response 200 — started**
```json
{ "block": "email-intake", "started": true }
```

**Response 200 — skipped (already running)**
```json
{ "block": "email-intake", "skipped": true, "reason": "already_running" }
```

### POST /api/jobs/:blockName/release

Manually clears the lock — use when the API process died or restarted
mid-run, so `/run`'s cleanup never got to release it and the lock would
otherwise stay stuck forever. Idempotent — safe to call whether or not the
lock was actually held.

**Response 200**
```json
{ "block": "email-intake", "released": true, "wasLocked": true }
```

---

## email-intake job (background behavior)

Module: `modules/email-intake/service.js`, started via
`POST /api/jobs/email-intake/run` above. Pulls new messages through the
configured **channel adapter** (`CHANNEL_DRIVER` — `channels/index.js`;
Day 1 default is `imap_smtp`, which reads the mailbox via `IMAP_*` env vars).
The adapter converts each raw message into a channel-agnostic `Submission`
object before the business logic ever sees it, so this module has no
IMAP-specific code — swapping to `CHANNEL_DRIVER=freshdesk` later needs only
`channels/freshdeskChannel.js` implemented, not a service rewrite.

For each submission:

1. Checks for an existing `EmailMessage` with the same `(source, external_id)`
   first — if found, skips immediately (recovery/replay no-ops cleanly, never
   creates a duplicate or orphaned `Case`/`EmailThread`).
2. Otherwise matches an existing `EmailThread`/`Case` via `Message-ID` /
   `In-Reply-To` / `References` headers, or creates a new `Case` +
   `EmailThread` if no match is found (`threadMatcher.js`).
3. Inserts the `EmailMessage` row.
4. Stores each attachment via the configured storage adapter
   (`STORAGE_DRIVER` — `storage/index.js`) and inserts an `EmailAttachment`
   row per file.
5. Logs `CaseEvent` rows (`EMAIL_RECEIVED`, then `ATTACHMENTS_STORED` →
   `READY_FOR_DOCUMENT_READING` if any attachments were stored) and updates
   `Case.currentStatus`.

On completion (success or failure), the result is logged server-side —
`processed` count and any per-submission `{ externalId, error }` entries on
success, or the thrown error on failure (channel connection/auth failure,
storage write failure, DB transaction failure) — and the job lock is
released either way.

---

## claim-recognition job (background behavior)

Module: `modules/claim-recognition/service.js`, started via
`POST /api/jobs/claim-recognition/run`. Picks up cases at
`currentStatus = 'READY_FOR_DOCUMENT_READING'` (Block 1's output), up to
`CLAIM_RECOGNITION_BATCH_LIMIT` per run.

For each case:

1. Gathers every attachment across every `EmailMessage` in the case's
   thread(s) — not just the message that first created it.
2. Rasterizes each attachment to page images (`rasterize.js`,
   `pdftoppm` + `sharp`, `CLAIM_RECOGNITION_RASTER_DPI`) and cleans up the
   temp files afterward.
3. **Vision pass**: one LLM call per page (`llmClient.js::transcribePage`),
   `reasoning_effort: 'none'` — required to avoid a verified failure mode
   where this class of model can enter an unbounded "thinking" loop on hard
   content (e.g. handwriting) that never converges even with a large token
   budget.
4. **Synthesis pass**: one text-only LLM call
   (`llmClient.js::synthesizeJson`) merges all page transcripts + the email
   content against the enabled routes in `ulink_claim_routes`, returning a
   route decision (`route`, `confidence`, `reason`) plus `extracted_fields`
   matching that route's `extraction_schema`.
5. Validates the parsed response against the same schema with `ajv` —
   on failure, `MANUAL_REVIEW` with `reasonCode: SCHEMA_VALIDATION_FAILED`,
   nothing untrusted gets persisted.
6. Transitions `Case.currentStatus`:
   - matched route + confidence ≥ `CLAIM_RECOGNITION_CONFIDENCE_THRESHOLD` → `RECOGNIZED`, `recognizedType` set
   - matched route, low confidence → `MANUAL_REVIEW` (`LOW_CONFIDENCE`)
   - no route matched (`fallback`) → `NOT_RECOGNIZED` (`NO_ROUTE_MATCH`)

   Sets `Case.extractedFields` to the validated JSON either way, and logs a
   `CaseEvent`.

**`extracted_fields` shape** (per the `ayas_member_claim` route): `policy`,
`claimant`, `claim`, `medical`, `bank` groups sourced from typed/printed
text (proven reliable); `documents_present` presence flags; `medical_record`
(`present` only — per meeting notes, no field-level check yet);
`invoice` (`present` + its own `date_of_voucher`/`invoice_amount`/
`patient_name`, captured as raw fields — comparison against the form's
fields is a code-level concern for later, not decided by the LLM).

---

## Error shape (all routes)

Unhandled errors and 404s go through `middlewares/errorHandler.js`:

**404**
```json
{ "error": { "message": "Not Found - /some/path", "status": 404 } }
```

**500** (stack included only outside production)
```json
{
  "error": {
    "message": "Internal Server Error",
    "status": 500
  }
}
```
