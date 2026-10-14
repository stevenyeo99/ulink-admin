# Reviewer checklist feedback — enhancement

Demo feedback 2026-10-02, item 2 ([demo_feedback.md](demo_feedback.md)):

> collect feedback from human review (for override decision), for document checking — don't STP.
> - correcting the AI summary checking list.

Status: **draft for discussion** (2026-10-08). Related backlog: **B5** (reviewer actions), **D1** (accuracy report),
**D2** (STP rule on AI confidence).

---

## 1. Problem

When a person reviews a case, the system learns nothing about **which** AI check was right or wrong.

Today a reviewer can only **override** a whole check (`modules/case-override/override.js`):

- one of 5 statuses (`INCOMPLETE`, `DOCUMENTS_REVIEW`, `API_DOCUMENTS_REVIEW`, `MEMBER_REVIEW_REQUIRED`,
  `API_MEMBER_REVIEW_REQUIRED`);
- one finding for the whole case (`AI_MISREAD` / `CUSTOMER_CONFIRMED` / `IAS_OUTDATED` / `OTHER`) + free-text reason;
- saved as one `CaseEvent` (`MANUAL_OVERRIDE`); the waived points are a text list inside the message.

So:

1. We can't tell *which* checklist item the AI got wrong ("Voucher readable" vs "Claimant name matches medical
   record") — only that something in the document check was overridden.
2. Checks the AI **passed** but got wrong are never recorded (no override happens on a pass).
3. Cases that are fine but go to JD3 (not STP) are never reviewed against the checklist at all.
4. D1 (accuracy per check, per confidence band) and D2 (STP on confidence) have no data to start from.

## 2. Goal

A reviewer can mark **each AI checklist item** as right or wrong, with the correct answer and a note.
The mark is **recorded only** — it does not change the case, the status, or the IAS claim.

That gives:

- the data for D1: how often each check is wrong, and at what confidence;
- an audit trail on the case: who confirmed / corrected what;
- a better override: the override says *which* items were wrong, not just "the AI misread".

### Out of scope (phase 1)

- Changing the case from a correction (re-run checks, update extracted fields, revise the IAS claim) — phase 2,
  after B5 is decided.
- Feedback on STP-paid cases (no person reviews them; random audit is **B4**).
- Roles beyond `super_admin` (S3).
- The accuracy report screen itself (D1) — phase 1 only stores the data; one SQL query in §7 reads it.

## 3. Which cases, which items

**Cases:** every case that is **not STP** and has a document check or member check result — i.e. any case a
person looks at: review queue, JD3 approvals, documents incomplete, and finished non-STP cases.
(Open question Q1.)

**Items** — the raw checklist items, not the collapsed summary lines (the summary merges "Other document checks"
and "Mandatory fields" into one line each; feedback must be per item to be useful for D1):

| Area | Source | Item key | Example |
|---|---|---|---|
| `documents` | `documentCheckResult.checklist[]` | `code` (+ `label` for `MISSING_MANDATORY_FIELD`) | `UNCLEAR_VOUCHER`, `PATIENT_NAME_INCONSISTENT`, `MISSING_MANDATORY_FIELD` / "Bank account number" |
| `member` | `memberVerifyResult.checks.hard` | key | `dobMatch`, `bankAccountNumberMatch` |
| `claim` | `claimPrepMeta` | `diagnosis`, `benefit[i]` | diagnosis code R42, benefit OP/… for voucher 1 (Q2) |

API cases read the same fields through `apiCaseView(steps)`, so one implementation covers both sources.

## 4. What the reviewer records per item

| Field | Values | Notes |
|---|---|---|
| verdict | `AI_RIGHT` / `AI_WRONG` / `CANT_TELL` | required |
| correct value | text | required when `AI_WRONG` on a value check (diagnosis code, a field the AI read wrongly); optional otherwise |
| who was wrong | `AI_VISION` (misread) / `AI_JUDGMENT` / `CUSTOMER` / `IAS_RECORD` | required when `AI_WRONG`; same vocabulary as the summary's `mightBeWrong` |
| note | text | optional |

Saved with each mark (snapshot, so a later re-check doesn't change what was judged):

- the AI's result at the time: `passed` (true / false / null), the AI's `note`, `confidence`;
- the case status at the time; whether the case was STP;
- username + timestamp.

Marks are **append-only**: marking an item again adds a new row; the latest row per item is the current one.
History is kept for audit.

Unmarked items = no opinion. The reviewer does not have to mark everything — but there is a
**"Mark all others AI right"** button so a full review is two clicks (Q3).

## 5. Design

### 5.1 Data — new table `ulink_checklist_feedback`

| Column | Type | |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk → ulink_cases | indexed |
| area | text | `documents` / `member` / `claim` |
| item_code | text | checklist `code` / hard-check key / `diagnosis` / `benefit` |
| item_label | text null | mandatory-field label, voucher index — whatever makes the item unique within the code |
| verdict | text check (`AI_RIGHT`, `AI_WRONG`, `CANT_TELL`) | |
| wrong_by | text null check (`AI_VISION`, `AI_JUDGMENT`, `CUSTOMER`, `IAS_RECORD`) | |
| correct_value | text null | |
| note | text null | |
| ai_snapshot | jsonb | `{ passed, note, confidence }` as shown to the reviewer |
| case_status | text | status when marked |
| is_stp | boolean | |
| username | text | |
| created_at | timestamptz | |

A new table rather than more `CaseEvent` text: D1 needs to count by `item_code` + `verdict` + confidence, which
can't be done reliably from free-text messages.

### 5.2 API (`routes/cases.js`, `controllers/cases/casesController.js`)

- `GET /api/cases/:id/checklist-feedback` — the latest mark per item (+ full history with `?history=1`).
- `POST /api/cases/:id/checklist-feedback` — body `{ marks: [{ area, itemCode, itemLabel?, verdict, wrongBy?, correctValue?, note? }] }`.
  Several marks in one call (one transaction), so "mark all others AI right" is one request.
  - `super_admin` only (same as override).
  - The server looks the item up in the case's **current** results and writes the snapshot itself — the client
    never sends the AI result. Unknown item → 400.
  - Rejects STP cases (Q1) and the `wrongBy` / `correctValue` rules from §4 → 400 with a plain message.

### 5.3 Console

- `components/panel/ChecklistTable.tsx`: each row gets three small buttons — ✓ AI right / ✗ AI wrong / ? Can't tell.
  "AI wrong" opens an inline form: who was wrong, correct value, note. A marked row shows
  "✓ Confirmed by Ulink · 8 Oct" or "✗ Corrected by Ulink — correct: R42 (AI misread)".
- Member check rows and the diagnosis / benefit lines get the same buttons (in `AssessmentSummaryPanel`).
- Top of the checklist: "**Mark all unmarked AI right**" and a counter "12 of 18 items reviewed".

### 5.4 Override (`CaseOverridePanel.tsx`, `overrideCase`)

Override stays as it is (it moves the case). Change: the override panel lists the failed / low-confidence items
and the reviewer marks which ones the AI got wrong; the marks are saved in the **same request and transaction**
as the override. The case-level `finding` stays for now (old data and the emails use it). (Q4)

### 5.5 Assessment summary / emails / IAS

- `buildAssessmentSummary` gets the latest marks next to `overrides` and adds them to the line
  (`reviewed: { verdict, by, at, correctValue }`), so the case page, JD3 email and review queue show them.
  Still no DB access inside the summary — the controller passes the marks in, as it does for overrides.
- `AiSummaryRemark` (IAS): **not changed** in phase 1 — the remark is sent when the claim is submitted, before
  most reviews. (Q5)

## 6. Phase 2 (later, needs B5)

A correction *changes* the case: e.g. corrected diagnosis code → claim revision in IAS; "AI wrong, voucher is
readable" → document check re-evaluated → case moves on. Needs: who may correct which item, which corrections
trigger an IAS revision, and E2 ("re-check this case"). Designed after phase 1 data shows which corrections are
common.

## 7. Reading the data (D1 starter)

```sql
-- Accuracy per check and confidence band, latest mark per item only
WITH latest AS (
  SELECT DISTINCT ON (case_id, area, item_code, coalesce(item_label, ''))
         *
  FROM ulink_checklist_feedback
  ORDER BY case_id, area, item_code, coalesce(item_label, ''), created_at DESC
)
SELECT area, item_code,
       CASE WHEN (ai_snapshot->>'confidence') IS NULL THEN 'none'
            WHEN (ai_snapshot->>'confidence')::numeric < 0.5 THEN '<0.5'
            WHEN (ai_snapshot->>'confidence')::numeric < 0.8 THEN '0.5–0.8'
            ELSE '≥0.8' END AS band,
       count(*) FILTER (WHERE verdict = 'AI_RIGHT') AS right,
       count(*) FILTER (WHERE verdict = 'AI_WRONG') AS wrong,
       count(*) FILTER (WHERE verdict = 'CANT_TELL') AS cant_tell
FROM latest
GROUP BY 1, 2, 3
ORDER BY wrong DESC;
```

## 8. Tests

- `tests/checklistFeedback.test.js`: item lookup and snapshot from an email case and an API case; validation
  (`AI_WRONG` without `wrongBy` → 400, unknown item → 400, STP case → 400); latest-mark-wins.
- `tests/caseOverride.test.js`: override with marks saves both in one transaction; override still works without marks.
- `tests/assessmentSummary.test.js`: a marked item shows `reviewed` on its line; the "Other document checks" line
  still collapses.

## 9. Size

**M (≈ 2 days)**: migration + model + 2 endpoints (½ d), console buttons/form (1 d), override + summary wiring and
tests (½ d). No AI change and no IAS change, so no risk to the running pipeline.

## 10. Open questions

| # | Question | Proposal |
|---|---|---|
| Q1 | Which cases? "For document checking, don't STP" — only non-STP cases? Or also STP cases (spot check)? | Non-STP only in phase 1; STP audit is B4 |
| Q2 | Include diagnosis code and benefit pick, or document + member checks only? | Include — diagnosis is one of the most corrected AI choices (R69 → R42) |
| Q3 | Must the reviewer mark every item, or only the ones they have an opinion on? | Optional, with "mark all unmarked AI right" |
| Q4 | Should an override **require** at least one item marked "AI wrong"? | Yes, when the finding is `AI_MISREAD` |
| Q5 | Show reviewer corrections in IAS (`AiSummaryRemark`) once the claim is revised? | No in phase 1 |
| Q6 | Who reviews — Ulink CSR/Ops, JD3, or both? (affects S3 roles; today everyone is `super_admin`) | Ulink to confirm |
