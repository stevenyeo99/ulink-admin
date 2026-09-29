# Console Upload by API (`cl-upload`) — Email Cases

Source: [console-upload-spec.md](console-upload-spec.md) (endpoint, request, response, barcode lookup).
Tracker: [20260917_enhancement_status.md](../PREV_FEEDBACK/20260917_enhancement_status.md), point 8 / C2 (action #12, 3rd demo).
Written and built 2026-09-29. Scope: **email cases only** — API cases' customers upload to the console themselves.

---

## 1. Problem

Today the email flow's `console-upload` job copies the claim's documents to the shared console folder, **makes up its
own barcode**, and moves the case straight to **Documents uploaded** (`DOCUMENTS_UPLOADED`). Claim preparation then
puts that barcode in the IAS payload.

With `cl-upload`, the documents are uploaded by API, but the console **creates the barcode later** (not in the
upload response). The case must not go on to claim preparation until the barcode exists — and while it waits, users
must see *why* it is waiting, not think it is stuck.

---

## 2. Target flow

```
Checks passed (MEMBER_VERIFIED)
   │ console-upload
   │   • case number check (AYA-CL- + 8 digits) — else "needs review", nothing uploaded
   │   • merge the claim's attachments into one PDF
   │   • POST cl-upload (TpaCaseNumber + PDF)
   ▼
Waiting for console barcode  (CONSOLE_BARCODE_PENDING)   ← new; normal wait, not an error
   │ console-barcode (every pipeline run)
   │   • GET /api/barcodes?scanId=API-<TpaCaseNumber>
   │   • our upload's barcode there  → save all the case's barcodes → next
   │   • not yet                     → leave the case, try again next run
   │   • none after 2 h              → "Console barcode not received" (needs review) + internal email;
   │                                   still checked every run, moves on by itself once the barcode arrives
   ▼
Documents uploaded (DOCUMENTS_UPLOADED) → ias-claim-preparation (unchanged)
```

Same "wait and retry each run" pattern the system already uses for the settlement report (`ias-claim-stp`).

---

## 3. Requirements

**R1 — Upload through `cl-upload`.**
POST multipart to `cl-upload` with `TpaCaseNumber` and `file` = one PDF of all the case's attachments (PDFs and
images merged, in attachment order). Header `x-api-key` from `.env`. Keep the response `path`.

**R2 — Check the case number before uploading.**
Email cases get `TpaCaseNumber` from the AI reading the claim form. It is the key the console files the upload
under (`API-<TpaCaseNumber>-01`) and the key the barcode lookup searches (`API-<TpaCaseNumber>`). If it doesn't
match `AYA-CL-` + 8 digits: don't upload; case → **Case number unclear** (needs review), reason on the case page.

**R3 — Show that the case is waiting for the console.**
New status **Waiting for console barcode** (`CONSOLE_BARCODE_PENDING`, group *In progress*, module *Claim & IAS*):
"Documents were uploaded to the console; waiting for the console to create the barcode. The system checks again
every run." Shown on:
- the status badge (Cases list, dashboard counts, filters) — from the status catalog;
- "Why the case went this way" — last step *Now — Waiting for console barcode*, plus a *Console upload* step:
  "Uploaded at hh:mm, waiting N min";
- the case page header description.

**R4 — Fetch the barcode on each run.**
GET the console middleware `/api/barcodes?scanId=API-<TpaCaseNumber>` (existing middleware URL,
`CONSOLE_MIDDLEWARE_URL`). Wait until **at least one barcode was created after our upload time** — that one is ours;
earlier ones are from earlier uploads of the same case.

**R5 — Several barcodes: `barcode` + `suppBarcode1`–`suppBarcode5`.**
When found, take **all** of the case's barcodes from the lookup, **earliest first**: the first → `barcode`, the next
five → `suppBarcode1`–`suppBarcode5`, unused slots `null`, more than six left out. Same rule as API cases
(`api-claim-preparation`'s `barcodeFields()` — moved to a shared place and reused, not copied). The email claim
payload gets `suppBarcode1`–`5` too (today it only sends `barcode`).

**R6 — Flag it after a time limit.**
The console's barcode job runs about every 15 minutes, so a barcode normally arrives 15–30 minutes after the upload.
No barcode **2 hours** after the upload (`CONSOLE_BARCODE_WAIT_MINUTES`, default 120) → **Console barcode not
received** (`CONSOLE_BARCODE_MISSING`, needs review) + one internal email (with the case link and "why the case went
this way"). The case is **still checked on every run** and moves on by itself once the barcode arrives.

**R7 — Failures and repeats.**
- Upload fails (network, 5xx, timeout): case stays at *Checks passed*, retried next run (technical failure).
- Upload rejected by the API (4xx / `status` ≠ `success`): case → needs review with the API's message.
- The case moves to *Waiting for console barcode* **only after** a successful upload response.
- A repeat upload of the same case (e.g. a crash after upload, before saving) becomes `-02`; R4/R5 handle it —
  all barcodes are listed, ours is the one after our upload time.

**R8 — Switchable, with the folder copy as fallback.**
`.env` `CONSOLE_UPLOAD_METHOD` = `cl-upload` or `folder` (today's copy + generated barcode). Default `folder` until
the console side is confirmed, so the demo can fall back.

**R9 — Recorded on the case.**
`consoleUploadResult` keeps `{ method, uploadedAt, path, file, barcodes: [{ barcodeId, scanId, createdAt }],
barcodeAt }`; `consoleBarcode` = the first barcode (as today). Case history: "Uploaded to console (cl-upload)",
"Console barcode VS… received (+N supplementary)".

---

## 4. Statuses

| Code | Label | Group | Set by | Next |
|---|---|---|---|---|
| `MEMBER_VERIFIED` | Checks passed | In progress | document-checking | console-upload |
| `CONSOLE_BARCODE_PENDING` **new** | Waiting for console barcode | In progress | console-upload | console-barcode |
| `CONSOLE_BARCODE_MISSING` **new** | Console barcode not received | Needs review | console-barcode (2 h) | console-barcode (keeps checking) |
| `CASE_NUMBER_UNCLEAR` **new** | Case number unclear | Needs review | console-upload (R2) | reviewer |
| `CONSOLE_UPLOAD_FAILED` **new** | Console upload refused | Needs review | console-upload (R7, API refused) | reviewer |
| `DOCUMENTS_UPLOADED` | Documents uploaded | In progress | console-barcode (or folder method) | ias-claim-preparation |

---

## 5. Configuration (`.env`)

| Key | Meaning |
|---|---|
| `CONSOLE_UPLOAD_METHOD` | `cl-upload` or `folder` (default `folder`) |
| `CL_UPLOAD_URL` | `cl-upload` endpoint |
| `CL_UPLOAD_API_KEY` | `x-api-key` — never in docs or git |
| `CONSOLE_BARCODE_WAIT_MINUTES` | Time limit before *Console barcode not received* (default 120) |
| `CL_UPLOAD_TIMEOUT_MS` | Upload request timeout (default 60000) |
| `CONSOLE_MIDDLEWARE_URL` | Existing — barcode lookup |

---

## 6. Build steps

| Done | # | Step | Size |
|---|---|---|---|
| [x] | 1 | Statuses + labels in the catalog (R3, section 4); journey *Console upload* step | Small |
| [x] | 2 | Merge attachments into one PDF (`pdf-lib` — new dependency, plain JS) | Small |
| [x] | 3 | `cl-upload` client + `console-upload` using it behind `CONSOLE_UPLOAD_METHOD` (R1, R2, R7, R8) | Medium |
| [x] | 4 | Middleware `listBarcodes(scanId)` in the existing client; new `console-barcode` job + pipeline step after `console-upload` (R4, R6) | Medium |
| [x] | 5 | Shared `barcodeFields()`; email payload gets `suppBarcode1`–`5` (R5) | Small |
| [x] | 6 | Internal email for *Console barcode not received*; console pipeline graph node | Small |
| [x] | 7 | Tests: upload success / failure / reject, case number check, barcode wait / found / several / time limit, payload barcodes | Medium |
| [ ] | 8 | Live check with the incomplete sample `AYA-CL-26031486` | — |

About 1–1½ days. Unchanged: ias-claim-preparation (still starts at `DOCUMENTS_UPLOADED`), IAS submission, STP, API cases.

---

## 7. Open questions (console / iAS team)

| # | Question | Default until answered |
|---|---|---|
| 1 | ~~How long does the console usually take to create the barcode?~~ Answered: its job runs every 15 min → 15–30 min | Time limit 2 h |
| 2 | Production URLs for `cl-upload` and `/api/barcodes` (spec shows `localhost:3023`) | From `.env` |
| 3 | Maximum PDF size per upload? A real sample case merged to **11 MB / 23 pages** | No limit set; size kept on the case |
| 4 | Should `cl-upload` replace the folder copy in production, or run alongside it? | Switch (R8), default `folder` |
| 5 | Is `-01`/`-02` always "per upload of the same case", created in upload order? | Yes (R4/R5 rely on `createdAt`) |

---

## 8. Out of scope

- API cases (customers upload to the console themselves; they already read barcodes from the middleware).
- Uploading documents a customer sends later for an email case (a second upload) — handled by R4/R5 if it happens,
  but no new trigger is added.
- Attachment storage location (tracker point 1).

---

## 9. Built (2026-09-29)

| Piece | Where |
|---|---|
| Switch, `cl-upload` path, case number check, one internal notice | `modules/console-upload/service.js` (`runByApi`, `queueConsoleUploadIssue`) |
| Merge to one PDF (`pdf-lib`; JPEG/PNG direct, other images via `sharp`) | `modules/console-upload/mergePdf.js` |
| `cl-upload` client (refused → review, server error → retry) | `modules/console-upload/clUploadClient.js` |
| Barcode lookup | `listBarcodes()` in `modules/api-material-download/middlewareClient.js` |
| Waiting job | `modules/console-barcode/service.js` (`decideBarcode` pure); pipeline steps `console-barcode`, `email-sender-console-upload`; `POST /api/jobs/console-barcode/run` |
| `barcode` + `suppBarcode1`–`5` for both flows | `modules/shared/barcodeFields.js`; email payload in `ias-claim-preparation/service.js` |
| Statuses, review-queue reasons, journey *Console upload* step | `case-status/catalog.js`, `review-queue/queue.js`, `assessment-summary/journey.js` |
| Internal email `CONSOLE_UPLOAD_ISSUE` | migration `20260929120000`, `EmailTask` model, `email-sender/templates.js` |
| Console pipeline graph node *Console Barcode* + badge | `ulink-console/src/graph/pipelineGraph.ts` |
| Tests | `tests/consoleBarcode.test.js`, `tests/consoleUploadByApi.test.js` (real PDF merge) |

**To switch on:** `.env` → `CONSOLE_UPLOAD_METHOD=cl-upload`, `CL_UPLOAD_URL`, `CL_UPLOAD_API_KEY`; restart the API.
Step 8 (live check with `AYA-CL-26031486`) is still to do.

