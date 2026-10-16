# SYSTEM_4 — session handoff (end of 2026-10-14)

Where the SYSTEM_4 enhancement work stopped, so the next session can continue without re-reading the whole history.
Plan of record: `SYSTEM_4_PRD.md` (requirements E4-01 … E4-27; section 8 = phases A–F with status and item
checklists). Change log: `4rd_system_enhancement_log.md`. Owner's tracker:
`docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md`.

## How we work (owner's rules)

- One phase at a time; within a phase **one item at a time**: share the item's plan → owner says "build …" → build →
  owner reviews and **commits** (the agent never commits; give a one-line message + file list, no Co-Authored-By).
- Every item updates, in the same change: PRD (requirement "Built …" note + section 8 checkbox / status), the log, the
  tracker, and `CLAIM_FLOW_END_TO_END.md` / `OPERATIONS.md` where behaviour changes.
- **No LLM calls without the owner's go-ahead** (tests replace `fetch`; the live suite `documentChecking.judge` is
  excluded: `npx jest --testPathIgnorePatterns documentChecking.judge`). No real IAS / cl-upload / email / UAT changes
  without a go-ahead. Read-only checks on the dev DB are fine; dev DB data changes are not.
- Tests mock the database; a test must never write to the dev DB (the AI call log needs `LlmCall` mocked).

## State at handoff

Working tree clean (everything committed; many files differ only in line endings). Last commit `f6c7667`.

| Phase | Items | State |
|---|---|---|
| A | E4-02 no inbox + **Read the mailbox** switch, E4-01 Email/API cases on/off, E4-03 API missing-documents email switch, E4-07 AI confidence threshold 70% (≤), E4-05 Burmese (already released) | Committed. **A6 / E4-06 chronic never-STP ICD list: waiting for ULINK's codes** (data entry, no code) |
| B | B1 E4-09 unsure passes wait for a person (switch #3), B2 E4-10 vitamins → no STP (on), B3 E4-27 token budget (30976 / 6000) | Committed |
| C | C1 E4-21 case header "Next", C2 E4-23 confidence badge, C3 E4-11 comment on every manual action | Committed |
| D | D1 E4-26 AI call log `ulink_llm_calls` (migration run on **dev**), D2 AI performance page, D3 baseline report `npm run report:baseline` | Committed |
| E | **E1 E4-04 done**: Console Watch job + Upload documents on the case page (cl-upload); Email Intake + Email Reply Intake skipped when the mailbox is not read | Committed (`f6c7667`) |
| E | E2 work queue, **E3 confidence + reason + page on every AI output**, E4 per-item correction, E5 review workspace, E6 daily dashboard | Not started |
| F | Learning from corrections | Not started |

## Next step (agreed recommendation)

**E3 (E4-08)** — confidence score + reason + source page on every AI output, plus format checks (NRC, policy no.,
dates, totals). Nothing open; E4 and E5 depend on it. It changes prompts (`extract-fields.md`, `transcribe-page.md`, …),
so verifying it needs **real AI runs — ask first**; Phase D (call log, AI performance page, baseline) measures before /
after. Start by sharing E3's item plan (owner reviews before building).

Then: E4 → E5 (after E3); E2 and E6 when ULINK answers.

## Open questions for ULINK (send together)

Q16 (do per-item corrections update IAS claim fields?), Q17 (roles; who marks a correction trusted), Q20 (daily
dashboard figures; overdue limit), Q21 (reviewers claim cases themselves or a supervisor assigns). Answered today:
Q1 yes (upload to the IAS console), Q2 all users, Q4 ≤, Q5 yes (revise automatically), Q9 keep switches #1/#2, Q12
only while waiting on documents, Q13 every AI output.

## Owner's to-dos outside the code

- STP settings (dev and UAT): **Read the mailbox (IMAP) → off** (dev still had it on); go-live values: email cases off,
  missing-documents email off; switch #3 / human-check switches as wanted.
- UAT deploy: `npm run db:migrate` (creates `ulink_llm_calls`); set `CL_UPLOAD_URL` / `CL_UPLOAD_API_KEY` for uploads.
- LM Studio: model settings → Context Overflow → **Stop at limit**; keep `LLM_CONTEXT_TOKENS` equal to the loaded
  context (30976).
- Run `npm run report:baseline` on UAT for the real "before" numbers (dev has only 1 case; the dev
  `baseline_20261014.md` was not meant to be committed).
- Try E1 on UAT on a test claim (real console upload → real AI re-check → real IAS revision) — when ready.

## Known, left alone

- Lint: `preserve-caught-error` on the timeout throw in `claim-recognition/llmClient.js` `postChatCompletion`;
  unused `claimDiagnosisText` (document-checking/service.js) and two unused checks in `checklist.js` — all older than
  SYSTEM_4.
- Live-LLM test suite timed out on 2026-10-14 while LM Studio was slow (not a code problem).
- Follow-up noted in the PRD (C3): a reason + change history for STP settings saves (needs a settings-history table).
