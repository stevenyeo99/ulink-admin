# AI Claim Assessment Summary — Requirement

Source: 17/09 meeting (`Ulink_AI_Claims_Automation_Meeting_Summary_Action.docx`) — discussion points 5, 6 and
actions #7, #8, #9, #10, #11. Written 2026-09-28 from checking the current system.
Related: [MEETING_20260917_ACTION_STATUS.md](MEETING_20260917_ACTION_STATUS.md).

### In scope vs out of scope

| 17/09 item | In this document? | Where it is handled |
|---|---|---|
| Point 5 / #7 — internal AI verification summary to CSR/Ops | **In scope** | R4, steps 6 and 10 |
| Point 6 / #9 — AI assessment summary retained in iAS | **In scope** | R3, step 13 |
| #10 — enrich the JD2 manual-approval email | **In scope** | R4, step 4 |
| #8 — dashboard vs notification | **In scope (partly)** — only the summary / review side; general monitoring views are not covered | R5, decision 1 |
| #11 — configurable STP rules | **Partly** — only how AI confidence may later feed STP (R6, decision 6); the STP rule set itself is not covered | [MEETING_20260917_ACTION_STATUS.md](MEETING_20260917_ACTION_STATUS.md) |
| #1 — attachment storage location | Out of scope | Meeting status file |
| #2, #3 — AYAS bank-account holder / delegation rule | Out of scope | Meeting status file |
| #4 — numbered missing-documents email | Out of scope (done 2026-09-28) | Meeting status file |
| #5 — Burmese translation | Out of scope (separate topic) | Meeting status file |
| #6 — acknowledgement email at intake | Out of scope (done 2026-09-28) | Meeting status file |
| #12 — console / document-upload method | Out of scope | Meeting status file |
| #13 — iAS/API submission automation | Out of scope (3rd demo) | Meeting status file |

---

## 1. Purpose

Let a reviewer (CSR/Ops, JD2, auditor) see **what the system and the AI decided on a case, why, and how far to trust
it** — and act on it when the system is unsure or might be wrong.

A case can be wrong for different reasons: the AI misread (vision), the AI misjudged (judgment), the customer
submitted wrong data, or the IAS record is out of date. The AI can also be **confidently wrong** — high confidence,
wrong answer — so confidence alone must never be treated as proof.

**Principle:** the summary is **built by rules from results already stored** on the case. No new LLM call —
consistent, cheap, auditable.

---

### Who uses it

`ulink-console` is not only a developer / demo tool: it will be the **internal users' dashboard** (CSR / Ops /
JD2) for reviewing the assessment and handling unsure cases. So:

- **Plain language** for business users — no status codes or field paths; always show *why*.
- **Read-only first.** Anything that changes data (reviewer actions) needs console login and "who can act" rules
  (decision 2) before it is built.
- The **review queue** is the natural home page for internal users; the pipeline graph and raw JSON sections stay
  as the developer view.

---

## 2. Terminology

### Review reason — why a case needs a human

| Review reason | Meaning | Example |
|---|---|---|
| **AI unsure** | The LLM made a judgment with low confidence | Diagnosis pick at 0.45 |
| **Unreadable** | A document couldn't be read reliably | Handwritten medical record |
| **Data mismatch** | Document and IAS disagree | DOB / bank account differs from IAS |
| **Missing information** | Something required is not there | No medical report |
| **Rule hold** | A business rule blocks it (AI is fine) | Coverage not active, over STP limit |
| **System issue** | Technical / integration failure | IAS rejected the revision, timeout |

### Who might be wrong

| Tag | Meaning |
|---|---|
| **AI vision** | OCR / image reading may be wrong |
| **AI judgment** | The LLM's decision may be wrong |
| **Customer** | Customer submitted wrong or incomplete data |
| **IAS record** | Reference data in IAS may be outdated |
| **None (rule)** | Deterministic policy outcome |

### How a decision was verified

| Tag | Meaning | Trust |
|---|---|---|
| **Rule (exact)** | Plain comparison or calculation | High |
| **Cross-checked** | AI result agrees with an independent source (IAS, another page, a calculation) | High |
| **AI self-rated only** | Only the LLM's own confidence — not verified | Treat as a hint |

### Findings (recorded by a reviewer)

**AI correct · AI vision wrong · AI judgment wrong · AI confidently wrong · Customer wrong · IAS wrong ·
Customer action needed · Escalated**

---

## 3. Requirements

**R1 — Every decision has a "why".**
For each decision (member check, documents, medical record, identity, voucher amount, diagnosis, benefit, STP):
result, reason / evidence, confidence, how verified.

**R2 — Every unsure line says why and who might be wrong.**
Tag with a review reason and a "who might be wrong" (section 2).

**R3 — The summary is saved with the case.**
Snapshot at key points (JD2 email, end of case), for **STP and non-STP**, as the audit trail. Sent to iAS later (#9).

**R4 — The summary is shown where people work.**
- JD2 approval email: summary + recommended next review point (#10)
- Internal alert to CSR/Ops for cases needing attention (#7)
- Console case page: explanation panel

**R5 — The dashboard supports human-in-the-loop review.**
- Review queue: cases needing a human, grouped by review reason
- Random audit sample of STP / auto-approved cases (the only way to catch "confidently wrong")
- Reviewer actions: **Confirm · Correct · Request from customer · Escalate** — each records who, when, what, why,
  and the finding (section 2)

**R6 — Learn from reviews.**
How often each AI decision is corrected, per confidence band. Later used to set a safe AI-confidence rule for STP
(#11).

---

## 4. Current system — what "why" exists (checked 2026-09-28, updated after steps 1–5)

| Decision | Decided by | Result stored | "Why" stored |
|---|---|---|---|
| Member / coverage / DOB / bank / policy | Rules | Yes | **Yes** — extracted value vs IAS value |
| Missing / incomplete documents | Rules | Yes | **Yes** — technical wording is rewritten in plain language by the summary builder |
| Medical record present / legible | LLM | Yes | **Yes** — `presence_reason` + confidence |
| Identity consistency | LLM | Yes | **Yes** — reason + confidence |
| Voucher amount | Rules + LLM | Yes | **Yes** — note + agreement-based confidence |
| Diagnosis code pick | LLM | Code, confidence, candidates, `defaulted` | **Yes (new claims)** — `reason` added 2026-09-28 |
| Benefit type / head pick | LLM | Pick, confidence, candidates | **Yes (new claims)** — `reason` added 2026-09-28 |
| STP yes / no | Rules | `isStp` + `claimPrepMeta.stp` | **Yes (new claims)** — total, limit, currency added 2026-09-28 |
| Member check with several problems | Rules | First problem only | **Partly** — later problems are not listed |

Other facts:
- Email cases store results on `ulink_cases`; API cases in `ulink_api_case_steps`. `apiCaseView()`
  (`modules/api-pipeline/caseView.js`) already maps API outputs to the same field names — one builder serves both.
- Console case page shows the **AI Assessment** panel (`AssessmentSummaryPanel.tsx`, replaced the scores-only `ConfidenceSummary.tsx`).
- "Needs a human" statuses exist (`MANUAL_REVIEW`, `API_MANUAL_REVIEW`, `MEMBER_REVIEW_REQUIRED`) but no queue
  view, no review reason, no reviewer actions; the console is read-only apart from "Run this step".
- JD2 email (`CLAIM_APPROVAL_REVIEW`) carries the claim number plus the assessment text (the audit snapshot for non-STP claims).

---

## 5. Build order (small, independent pieces)

| Decide | Step | What | Covers | Size | Blocked by |
|---|---|---|---|---|---|
| [x] | 1 | **L0** (done 2026-09-28) — store a reason for diagnosis / benefit picks (`reason` in the picker results); store STP total + limit (`claimPrepMeta.stp`) | R1 | Small | — |
| [x] | 2 | **L1** (built 2026-09-28, `modules/assessment-summary/summary.js`) — explanation builder: result, why, confidence, how verified, review reason, who might be wrong; plain-language document reasons | R1, R2 | Small–Medium | — |
| [ ] | 3 | **L1b** — save the summary snapshot with the case. **Non-STP done** 2026-09-28 (JD2 email task payload / api-claim-revision output); **STP still open** (no JD2 email → save at case end, CSR sent) | R3 | Small | — |
| [x] | 4 | **L3** (built 2026-09-28) — summary in the JD2 approval email | R4 (#10) | Small | — |
| [x] | 5 | **L2** (built 2026-09-28, `AssessmentSummaryPanel.tsx`) — explanation panel on the case page | R4 | Small–Medium | — |
| [ ] | 6 | Summary in the internal member-issue email | R4 (#7 part) | Small | — |
| [ ] | 7 | Review queue page (read-only) | R5 | Medium | — |
| [ ] | 8 | Random audit sample | R5 | Small–Medium | Audit % |
| [ ] | 9 | Reviewer actions — Confirm + Request first, Correct later | R5 | Medium–Large | Decisions 2, 3 |
| [ ] | 10 | Internal alert for other "needs attention" cases | R4 (#7 rest) | Medium | Decision 1 (#8) |
| [ ] | 11 | Member check lists every problem, not just the first | R1 | Medium | — (careful testing) |
| [ ] | 12 | Accuracy report from reviewer findings | R6 | Medium | Enough reviews |
| [ ] | 13 | Send the summary to iAS | R3 (#9) | Small once known | iAS field / API |

Steps 1–7 can start now. Steps 1–4 give the first visible result: the JD2 email explains the AI's decisions, for
both email and API cases.

---

## 6. Next actions (ordered)

Status 2026-09-28: summary CR steps 1–5 built (L0, L1, L1b non-STP, L2, L3).

**Before the demo**
1. Commit summary steps 1–5.
2. LLM model confirmed: `qwen/qwen3.6-35b-a3b` (picks match 24/09).
3. Rehearse with one fresh claim — check the AI Assessment panel (STP numbers, diagnosis / benefit reasons, review
   points) and the JD2 email if non-STP. Existing cases show "Reason not recorded" until prepared again.

**Next to build (small, no decision needed)**
4. Save a summary snapshot for STP claims at case end (CSR sent) — finishes step 3.
5. Summary in the internal member-issue email — step 6.

**After that (bigger, no decision needed)**
6. Review queue page, read-only — step 7.
7. Member check lists every problem, not just the first — step 11.

**Ask at the demo (unblocks the rest)**
8. Audit % for STP cases → random audit sample — step 8, decision 4.
9. Who can act on the dashboard, what they can correct → reviewer actions — step 9, decisions 2, 3.
10. Which cases email CSR/Ops vs dashboard only → internal alerts — step 10, decision 1.
11. iAS field for the summary → send to iAS — step 13, decision 5.

**Later**
12. Accuracy report, once reviewer actions exist — step 12.

---

## 7. Decisions needed (take to the demo)

| Decide | # | Question |
|---|---|---|
| [ ] | 1 | Which cases **email** CSR/Ops vs **dashboard only** (#8)? Suggested: member issue, incomplete documents, IAS rejection, low confidence → email |
| [ ] | 2 | **Who can act** on the dashboard (CSR / Ops / JD2), and what may they **correct**? |
| [ ] | 3 | Does a correction **update iAS automatically**, or stay a manual step? |
| [ ] | 4 | **Random audit %** for STP / auto-approved cases (e.g. 5–10%)? |
| [ ] | 5 | **iAS field / API** to store the summary (#9) — iAS team |
| [ ] | 6 | Until calibration data exists, STP stays on **amount + risk rules + cross-checks**, not AI confidence — agreed? |
