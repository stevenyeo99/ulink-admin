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

**Currently registered blocks**: `email-intake` (see below). Other blocks
(document-reader, document-classifier, claim-scope-classifier) are out of
scope for the current build phase and not mounted.

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
