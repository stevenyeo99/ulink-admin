# ulink-admin

AI claims automation for AYA Sompo (via ULINK, the TPA). Claims arrive by **email** or as **API cases** (created in
IAS), go through one set of checks (AI reading, IAS member check, document check, diagnosis/benefit, STP), and end in
IAS with every decision explained. JD3 approves non-STP claims in IAS; STP claims pay straight through.

- `src/ulink-api/` — Express + Sequelize (Postgres, pgvector) + local LLM. Scripts: its `package.json`.
- `src/ulink-console/` — React/Vite dashboard for CSR / Ops / JD3 (`npm run build` type-checks).
- `docs/imp/` — requirements, demo material, status tracking.

## Read before changing behaviour

- **Domain words** (TPA case number vs claim number, suspense, barcode, JD1–JD3, …): `CONTEXT.md` — use its terms in
  code, docs and replies.
- **How it works now:** `docs/imp/CLAIM_FLOW_END_TO_END.md` — every job, status, email, human checkpoint, setting.
- **Running, fixing, deploying:** `OPERATIONS.md`.
- **Why it is built this way, and scaling:** `DESIGN.md`.
- **What is next:** `BACKLOG.md`.
- **Adding or changing a job, status, email type, or setting:** the `ulink-pipeline-change` skill
  (`.claude/skills/ulink-pipeline-change/SKILL.md`) — its checklist is where past bugs came from.

## The status chain

Jobs never call each other. Each job selects cases by `Case.currentStatus`, works on them, and moves them to the next
status; the pipeline orchestrator runs every job in order (`modules/pipeline/service.js`: `STEPS` for email,
`API_STEPS` for API). A case waiting at a status is normal. To follow a case, read its `ulink_case_events` history.

## Rules

- **Email and API cases stay apart.** API cases hold only `API_…` statuses (DB constraint). Email jobs select exact
  email statuses; API jobs filter `source = 'API'`.
- **Every table is prefixed `ulink_`.**
- **Every status lives in `modules/case-status/catalog.js`** with a plain-words label and description — the console,
  review queue and journey read it.
- **Every decision keeps its reason.** Results carry a `reason` / confidence; the assessment summary
  (`modules/assessment-summary/`) turns them into the "why" shown on the case page, in team emails and in IAS
  (`AiSummaryRemark`). It is built by rules from stored results — no LLM call.
- **Failures by kind:** a technical failure (network, timeout, 5xx) throws and leaves the status for retry next run; a
  business answer (IAS rejects, upload refused) moves the case to a *needs review* status and is not retried.
- **Customer-facing wording** is approved canned text — change it only on request. Team emails start `(ULINK AI) `.
- **Tests mock the database**, so a list in a Sequelize model (e.g. `EmailTask` task types) can drift from its DB
  constraint unnoticed — `tests/emailTaskTypes.test.js` guards that one; follow the same pattern for new lists.

## Working with the owner

- "**Advise**" / "advise only" means analysis and a recommendation — no file changes.
- Record every behaviour change as a dated row in the change log of
  `docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md` (the owner's tracker).
- Real side effects need a go-ahead: sending email, calling IAS create/revise, uploading to the console, deleting data.
  Read-only checks against the dev DB and the console middleware are fine.
- **The owner commits, never the agent.** After each change, suggest a one-line commit message (no `Co-Authored-By`
  trailer) and the files it covers: only files with real changes (many docs differ only in line endings —
  `git diff --ignore-cr-at-eol`), never `.env`, no secrets (check `.env.example` and docs), no Word lock files (`~$…docx`).
