# ulink-admin — Operations

How to run, operate and fix the system. How each job behaves: [docs/imp/CLAIM_FLOW_END_TO_END.md](docs/imp/CLAIM_FLOW_END_TO_END.md).
Why: [DESIGN.md](DESIGN.md). Words: [CONTEXT.md](CONTEXT.md).

---

## 1. Set up

Needs: Node 18+, Postgres with the `vector` extension, an OpenAI-compatible LLM server (LM Studio: vision, chat and
embedding models), IMAP/SMTP for the claims inbox, and network access to IAS, the console middleware and cl-upload.

```bash
# API
cd src/ulink-api
cp .env.example .env            # fill in: DB, LLM, IMAP/SMTP, IAS, INTERNAL_REVIEW_EMAIL, JWT secret, console URLs
npm install
npm run db:migrate
node scripts/ingestIcd10Diagnoses.js      # once: ICD-10 diagnoses + embeddings
node scripts/ingestPolicyExclusions.js    # once: policy exclusion clauses + embeddings
npm run user:create -- <username> --name "Full Name" --role super_admin
npm run dev                     # http://localhost:3088 (PORT) · API docs at /api/docs

# Console
cd src/ulink-console
cp .env.example .env            # VITE_API_BASE_URL=http://localhost:3088
npm install
npm run dev                     # http://localhost:5173
```

Every `.env` key is documented in `.env.example`. Secrets live only in `.env`.

---

## 2. Run the pipelines

| What | How |
|---|---|
| Email pipeline, all steps | `POST /api/jobs/pipeline/run` (or console → Pipeline → Email → Run) |
| API pipeline, all steps | `POST /api/jobs/api-pipeline/run` (console → Pipeline → API) |
| One step only | Same endpoint with body `{ "steps": ["<step name>"] }`, or the step's own `POST /api/jobs/<job>/run` |
| Past runs | `GET /api/jobs/pipeline/runs`, `GET /api/jobs/pipeline/runs/:id` (same under `api-pipeline`) |

Schedule both orchestrators with cron (API pipeline: every 30 minutes; email pipeline: as often as mail should be
picked up). Job endpoints are open to cron; everything else needs a console login.

Every call returns at once and works in the background. A trigger that overlaps a running one is **skipped**, not
queued. A pipeline whose cases are switched off (STP settings → *Work on email / API cases*) is skipped too
(`reason: source_disabled`) — no run is created.

**No inbox** (API-only go-live): switch off *Read the mailbox (IMAP)* on the STP settings page, or leave `IMAP_HOST`
empty. The email-intake step is then skipped in both pipelines, and api-reply-intake in the API pipeline, with the
reason; SMTP sending is not affected. The
switch is the quick way to stop one environment reading a mailbox it shares with another (UAT and a dev machine). If the process died mid-run, the lock stays: clear it with `POST /api/jobs/<job or pipeline>/release`.

---

## 3. Follow a case

1. **Console → Cases → the case.** Read the status badge, *Why the case went this way*, and *Case history* (every
   status change, email and override, with who and why). *Show technical details* has the raw results and, for API
   cases, every job step's input/output/error.
2. **Find who acts next** from the status: [status catalog](docs/imp/CLAIM_FLOW_END_TO_END.md#6-status-catalog).
3. **Waiting at a system status for more than a run?** Check that run's steps (`/runs/:id`): a failed step has its
   error; the job's per-case errors are in its result summary.

---

## 4. Common situations

| Symptom | Likely cause | Action |
|---|---|---|
| Stuck at *Waiting to be read* / any system status | Pipeline not running, step failing, or lock left by a crash | Check the latest run; fix the error; release the lock |
| *Needs manual reading* | AI not confident about the claim type, its reading didn't fit the form, or "Documents too long for the AI" (the claim's text exceeds the model's context) | Look at the documents; reset once fixed, or handle manually |
| *Member check issue* | Mismatch with IAS (every problem listed) | Fix IAS (the case re-checks every run) or *Override and continue* |
| *Documents incomplete* | Missing items; customer emailed | Wait for the reply (it restarts the case), or override if the AI was wrong |
| *Check before emailing customer* | AI unsure a document is missing (switch #2) | *Send the request to the customer*, or override |
| *Waiting for console barcode* > 30 min | Console barcode job slow | Wait; after 2 h the case goes to *Console barcode not received* and the team is emailed; still checked every run |
| *Case number unclear* | TPA case number read from the form isn't `AYA-CL-` + 8 digits | Check the form; reset, or fix the documents |
| *Console upload refused* | cl-upload returned an error | Read the message in the case history; fix and reset |
| *Uploaded — waiting for the console* > 30 min | The console hasn't given the upload a barcode yet | Wait; after 2 h → *Upload not in the console*; check the console |
| Upload button says "not set up" | `CL_UPLOAD_URL` / `CL_UPLOAD_API_KEY` missing | Set them in `.env`, restart |
| *IAS rejected the claim / revision* | IAS business answer (e.g. "Claim already exists") | Read IAS's reason (team email); fix in IAS; not retried automatically |
| API claim not picked up | Same TPA case number already used by another API case | Intake reports the clash; resolve the duplicate |
| Emails not arriving | SMTP settings, or `INTERNAL_REVIEW_EMAIL` unset (team emails fail) | Check the case history for "sent"; check the email task error |

**Reset** (case page, super admin) reprocesses a case from reading; refused once the case has an IAS claim number.
**Override** lets a case past a check with a recorded reason. Neither undoes an email already sent.

---

## 5. Settings that change behaviour

- **Console → STP settings** (super admin): STP rules per case source and benefit type, never-STP diagnoses, the
  two human-check switches, the AI confidence threshold (default 70%), which cases the system works on (email / API),
  whether the mailbox is read, and whether API customers get the missing-documents email. Go-live (API only): email
  cases off, mailbox off, missing-documents email off. One form, one Save: edits are marked until **Review & save**, which lists every change
  and saves all of it or nothing (**Discard** drops them). Changes apply to cases processed after the save.
- **`.env`**: `CONSOLE_UPLOAD_METHOD` (`folder` / `cl-upload`), wait times, batch limits, URLs. Restart after a change.

---

## 6. Deploy

1. Pull the code; `npm install` in both packages.
2. **`npm run db:migrate` before starting the new code** — new code may need new tables, statuses or email types.
3. Add any new `.env` keys (compare with `.env.example`).
4. Restart the API; build the console (`npm run build`) and serve `dist/`.
5. Run one case through both pipelines and read its journey.

Rollback: `npm run db:migrate:undo` steps back one migration at a time; check each migration's `down` first.

A migration that changes a claim route's `extraction_schema` (e.g. `20261015100000-add-field-evidence`) changes what
the AI is asked to return: run it together with the matching prompt change, and try a few claims before go-live.

AI calls go through `node:http` (`claim-recognition/llmClient.js`), not `fetch` — Node's `fetch` stops waiting for
the response headers after 5 minutes, which a long field-mapping call can exceed; `LLM_TIMEOUT_MS` is the one timeout.
The field-mapping answer is capped at `LLM_OUTPUT_RESERVE_TOKENS` (6000), so a model stuck repeating itself stops within
a minute; a cut-off answer sends the case to *Needs manual reading* (like documents that are too long), never a retry
loop. The judgment calls (names, diagnosis, benefit, exclusions) are not capped — their reasoning counts toward it.

---

## 7. Logs

- `src/ulink-api/logs/combined.log` and `error.log` (Winston), plus the console output.
- Pipeline and step results: `ulink_pipeline_runs`, `ulink_pipeline_run_steps`; API case steps: `ulink_api_case_steps`.
- Per case: `ulink_case_events` (the case history).

## LLM context (long claims)

The whole claim's text goes to the model in one call. `LLM_CONTEXT_TOKENS` must equal the context length the model is
loaded with in LM Studio (UAT: 30976); `LLM_OUTPUT_RESERVE_TOKENS` (6000) is kept for the answer. A claim estimated over
the rest goes to *Needs manual reading* ("Documents too long for the AI") instead of being sent. The estimate counts
characters, not the model's tokenizer; each whole-claim call logs `LLM call size` (`estimatedTokens`, `limit`) — check
those lines to see real claim sizes. Backstop on the LM Studio machine: model settings → *Context Overflow* → **Stop at
limit** (not *Truncate middle* / *Rolling window*), so an underestimate errors instead of silently cutting pages.
Change `LLM_CONTEXT_TOKENS` whenever the model's context length is changed, then restart the API.

## AI call log

Every call to the AI is a row in `ulink_llm_calls` (migration `20261014100000-create-llm-calls`): case, job, prompt name
and version, model, status (`ok` / `error` / `timeout` / `too_long`), duration, tokens, the answer and its confidence.
Per case: console → case → technical details → *AI calls*. Per prompt version: console → **AI performance** (super
admin; `GET /api/llm-calls/summary?days=7|30`) — calls by status, time, tokens, average confidence and the share unsure,
old and new versions side by side after a prompt change. The prompt version is the start of the prompt text's SHA-256,
so an edited prompt shows up as a new version. A failed log write never stops a claim (server log: "AI call log write
failed"). Kept with no time limit for now; it holds the AI's answers, which can contain medical details.

**AI baseline report:** `npm run report:baseline` (in `src/ulink-api`) writes `docs/imp/CR/SYSTEM_4/baseline_<date>.md`
from the cases in the database it is pointed at — per checklist item how often it fails and how often the AI is unsure,
review points, member-check results, diagnosis fallbacks, STP rate and reasons, overrides. Read-only (SELECTs only), no
AI calls. Run it on the environment with real cases (UAT) before and after a prompt change; a different output path can
be given: `npm run report:baseline -- /tmp/baseline.md`.
