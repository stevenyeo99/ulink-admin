---
name: ulink-pipeline-change
description: Checklist for changing the ulink-admin claim pipeline. Use when adding or changing a job, a case status, an email type, a setting or switch, or a migration — in the email flow, the API flow, or both.
---

# Changing the claim pipeline

A change here touches several registries that must agree. Each step below ends on its completion criterion; a step
that doesn't apply is marked "n/a" with the reason, never skipped silently. Paths are relative to `src/ulink-api/`
unless they start with `src/ulink-console/` or `docs/`.

## 1. Place the change

Read the step in `docs/imp/CLAIM_FLOW_END_TO_END.md` that the change sits in. Decide: email flow, API flow, or both
(the checks are shared code — `api-*` jobs call the email modules' `checkCase`).

**Done when** you can name every job, status and email the change touches, per flow.

## 2. Statuses

For each new status:
- `modules/case-status/catalog.js` — module, group (`in_progress` / `waiting_customer` / `needs_review` / `done` /
  `failed`), plain-words label and description. API statuses start `API_`; email statuses never do.
- `needs_review` → a reason in `modules/review-queue/queue.js` `STATUS_REASONS` (otherwise it shows "AI unsure").
- A person can let the case past it → `modules/case-override/override.js` `OVERRIDE_TARGETS` + `OVERRIDE_AREAS`.
- The case waits for the customer → email: `modules/email-intake/service.js` `AWAITING_CUSTOMER_STATUSES`;
  API: `modules/api-reply-intake/service.js` `inputStatus`.

**Done when** every status the code writes is in the catalog (`tests/caseStatusCatalog.test.js` passes) and each has
its reason, override and reply handling decided.

## 3. Jobs

For each new or changed job:
- `run()` selects **exact** statuses (email) or `source = 'API'` + `API_…` statuses (API jobs via `runApiJob`, with
  `inputs` / `optionalInputs`). Technical failure → throw (retried); business answer → a *needs review* status.
- Register it: `modules/pipeline/service.js` (`STEPS` / `API_STEPS`, in order) and `routes/jobs/index.js`
  (`createJobRouter` + an `@openapi` block).
- Email job → add to `tests/emailJobIsolation.test.js` `EMAIL_JOBS`.
- Console graph: `src/ulink-console/src/graph/pipelineGraph.ts` (node + edges; shift the nodes below it),
  `src/ulink-console/src/types/pipeline.ts` `BlockName`, icon in `components/workflow/PipelineNode.tsx`.

**Done when** the job is in the pipeline, has an endpoint, appears on the console Pipeline page, and (email) is in
`EMAIL_JOBS`.

## 4. Email types

For each new email type, all of:
- Migration replacing `ulink_email_tasks_task_type_check` with the full list (copy the previous migration's list).
- `db/models/emailTask.js` `isIn` list **and** `tests/emailTaskTypes.test.js` `QUEUED_TYPES`.
- `modules/email-sender/templates.js` renderer in `RENDERERS`. Team emails: `(ULINK AI) ` subject prefix and
  `internalExtras(payload)` (case link + assessment); add to `INTERNAL_ONLY_TASK_TYPES` and `CASE_EVENT_STATUS` in
  `modules/email-sender/service.js`.
- Sent by: email flow → an `email-sender-*` step's `taskTypes` in the pipeline (+ console `EMAIL_BADGES`,
  `EmailSenderBlockName`); API flow → the job's step `output.email = { taskType, audience, payload, dedupeKey }`, and a
  new producing job goes in `modules/api-email-sender/service.js` `SOURCE_JOBS`.

**Done when** the type is in the migration, the model, the test list, the renderer map and a sender, and a template
test renders it.

## 5. The "why"

A new decision stores its result **with a reason** (and confidence when the AI decides). Show it:
`modules/assessment-summary/summary.js` (a line in the assessment) and, for a new stage, `journey.js` (a step in
"why the case went this way"). Team emails and IAS `AiSummaryRemark` pick both up automatically.

**Done when** the case page explains the new decision without reading raw JSON.

## 6. Settings

- Deploy value → `config/index.js` + `.env.example` (never a real secret in docs or git).
- Business switch the owner changes from the console → `modules/settings/settings.js` `DEFAULTS` (off unless decided)
  + the STP settings page.

**Done when** the default keeps today's behaviour and the setting is documented where it is set.

## 7. Migrations

Tables prefixed `ulink_`; `up` and `down`; run `npm run db:migrate` on dev.

**Done when** the migration ran on dev and is listed for the owner as a deploy step.

## 8. Verify

`npm test` in `src/ulink-api` (whole suite); `npx tsc -b` and `npx eslint <changed files>` in `src/ulink-console`.
Where real data helps, a **read-only** run against the dev DB or console middleware (close the DB connection;
`node -e` otherwise hangs). Real email / IAS / console uploads only with the owner's go-ahead.

**Done when** the whole suite passes and each changed behaviour has a test that fails without the change.

## 9. Record

- Dated row in the change log of `docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md`.
- Update `docs/imp/CLAIM_FLOW_END_TO_END.md` where the described behaviour changed; `BACKLOG.md` if an item closed or
  a new one appeared.

**Done when** someone reading only those docs would know the change exists and how it behaves.
