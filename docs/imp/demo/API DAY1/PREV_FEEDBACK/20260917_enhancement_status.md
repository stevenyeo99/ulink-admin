# 17/09 Meeting — Enhancement Status

Source: `Ulink_AI_Claims_Automation_Meeting_Summary_Action.docx` (same folder), "Key Discussion Points".
Status checked against the system on 2026-09-28.
Related: [MEETING_20260917_ACTION_STATUS.md](MEETING_20260917_ACTION_STATUS.md) (action items),
[SUMMARY_REQUIREMENT.md](SUMMARY_REQUIREMENT.md), [CONSOLE_DASHBOARD_DESIGN.md](CONSOLE_DASHBOARD_DESIGN.md).

Legend: ✅ done · 🟡 partly done · 🔴 not started / minimal · ⏸ later (by decision) · 🗣 to discuss

---

## 1. Overview

| # | Meeting point | Status | Next |
|---|---|---|---|
| 1 | Attachment storage | ⏸ Later | Discuss later |
| 2 | AYAS delegation rule | ⏸ Later | Waiting for the AYAS exception list |
| 3 | Customer communication | 🟡 Numbered list done; Burmese not | Decide Burmese scope |
| 4 | Acknowledgement trigger | ✅ Done | Check live in the demo rehearsal |
| 5 | Internal review | 🟡 Review queue, JD2 email, AI summary + case link in internal emails done | Decide email vs dashboard (#8) |
| 6 | AI assessment history | 🟡 Done inside our system; not in iAS; STP not saved | Save STP summary; iAS field from iAS team |
| 7 | STP governance | 🔴 Amount only | Plan below — decisions from Ulink |
| 8 | API / integration | 🟡 API case workflow built; documents still via console | `cl-upload` (3rd demo) |
| — | Console upload (action #12) | 🗣 To discuss | Questions below |

---

## 2. Detail per point

### 1. Attachment storage — ⏸ later
- **Asked:** decide AWS / Ulink local / DRT local; storage during vs after processing.
- **Today:** local storage adapter.
- **Next:** discuss later (decision owner: Ulink + DRT/IT).

### 2. AYAS delegation rule — ⏸ later
- **Asked:** a different bank-account holder should be a payment/delegation rule, not an automatic
  member-verification failure.
- **Today:** still a hard fail (`BANK_DETAILS_MISMATCH`). A reviewer can now **override** it with a reason
  (see point 5) — a workaround, not the rule.
- **Next:** AYAS exception scenarios (Dr KP / Ulink), then the rule.

### 3. Customer communication — 🟡 partly
- ✅ **Numbered missing-documents email** — each item numbered, reason under it
  (`email-sender/templates.js`, built 2026-09-28). Same template for email and API cases.
- ❌ **Burmese emails (outbound)** — not done. **Decision needed:** full email, or at least the
  missing-documents section; English + Burmese in one email; approved wording; Unicode.
- ✅ **Burmese diagnosis (inbound), built 2026-09-28** — a Burmese diagnosis / treatment is translated to
  clinical English *before* the ICD-10 search and the diagnosis / benefit picks
  (`ias-claim-preparation/medicalTranslation.js`). OCR and the IAS payload keep the original text. The AI
  assessment shows "Translated from Burmese as: …" and marks the line "AI translated". Real case
  AYA-CL-26034912: before → generic codes, defaulted to R69; after → neck-related candidates, a real pick.
  The Burmese reading itself can vary between AI runs — a reviewer should check it.
- 🔜 **Burmese names in comparisons** — not built: build only once real cases show Burmese-script names
  in the member check (today's cases have Latin-script names there). Plan: cross-script names use the
  existing AI name judgment instead of letter-by-letter compare; unsure bank-name matches still go to a person.

### 4. Acknowledgement trigger — ✅ done
- The "claim received" email is sent **once per case, right after the claim is recognised** — email cases
  after claim recognition, API cases after the API recognition step. It is separate from the later
  missing-documents / settlement-report emails. It is no longer sent after the document check.
- Side effect (a fix): the "submission not recognised" email, previously queued but never sent, now goes out.
- **Next:** confirm live in the demo rehearsal (one "Claim received" email per case).

### 5. Internal review — 🟡 partly
- ✅ **Review queue** on the dashboard — cases needing a person, grouped by reason, oldest first
  (case-level exceptions for CSR/Ops; the meeting's "dashboard for monitoring").
- ✅ **JD2 approval email includes the AI assessment** (action #10) — what was decided, why, and what to
  check first.
- ✅ **Approvals page** for JD2 — non-STP claims waiting for approval, with the AI's review points.
- ✅ **Override and continue** — a reviewer can let a case past a wrongly flagged document / member check,
  with "why was the check wrong" + reason, recorded against their login. The overridden points stay visible
  but are marked "✔ Overridden by … — why: reason" on the case page and in the JD2 / IAS-rejection emails,
  and no longer count as open (Review queue, needs-review colour).
- ✅ **Action #7, for the existing internal emails (built 2026-09-28):** the member-issue and IAS-rejection
  emails (email and API cases) now carry the **AI assessment** (review points first), like the JD2 email;
  all three internal emails have an **"Open this case" link** to the console (`CONSOLE_URL`).
- ❌ No internal email yet for other attention cases (AI couldn't read the documents, AI unsure) — see #8.
- ❌ **Action #8:** which cases email CSR/Ops vs dashboard only — **decision needed**.
- **Next:** decide the email-vs-dashboard rule (#8). Proposal: email when work is blocked until a person
  acts (member / bank issue, IAS rejected, AI couldn't read the documents); dashboard only for the rest
  (AI unsure on a case still moving, waiting on customer); optionally one daily summary email of the
  Review queue.

### 6. AI assessment history — 🟡 done for now, inside our system
- ✅ Every case shows its **AI assessment** in the console (what was decided, why, how sure, how verified,
  review points, who might be wrong). Diagnosis / benefit picks now give a reason; STP shows the amount
  against the limit.
- ✅ **Non-STP** claims keep a saved copy (the text in the JD2 email = audit snapshot).
- ❌ **STP** claims have no saved copy yet — small fix (save at case end).
- ❌ **Kept in iAS** — needs a field or API from the iAS team.
- Detail: [SUMMARY_REQUIREMENT.md](SUMMARY_REQUIREMENT.md).

### 7. STP governance — 🔴 amount only
- **Asked:** STP must not rely on amount alone; configurable rules (amount, diagnosis, AI confidence, others).
- **Today:** STP = total ≤ **50,000 MMK** (a demo value, per route + currency, table `ulink_stp_limits`).
  Real example of the risk: `AYA-CL-26034912` went STP with a **defaulted diagnosis (R69, AI confidence 0)**.

**Suggested plan**

| Phase | What | Needs |
|---|---|---|
| 1. Safety rules now | Not STP if: diagnosis **defaulted**; **any open review point** (AI unsure, data mismatch, unreadable); a person **overrode** a check | Nothing new |
| 2. Configurable | Dashboard Settings: amount limit per route; list of diagnosis codes that never go STP; switches for the phase-1 rules | Who can edit |
| 3. AI confidence rule | Only once override / accuracy data shows which confidence is really trustworthy (the AI can be confidently wrong) | Real review data |

**Decisions for Ulink:** real amount limit · diagnoses / claim types that must never be STP · should "any
open review point" block STP · who can change the rules.

### 8. API / integration — 🟡 partly (a different scope)
- ✅ **API case workflow** built — claims created in IAS (`get_claim_api`) → document download from the
  console → recognition, member and document checks → **claim revision** in IAS → settlement report.
  Covers claim payload, IAS answer handling and retry of technical failures.
- ❌ The meeting's action #13 means **our system submitting to iAS by API** — payload **and documents**,
  returned claim number, retry. Documents still go **through the console**; the `cl-upload` API is not used.
- **Next:** the 3rd demo — needs the `cl-upload` spec and a test account.

### Console upload (action #12) — 🗣 to discuss
- **Today:**
  - Email cases: a job **copies documents to the shared console folder** and generates the barcode.
  - API cases: the customer uploads to the console; we **read** the images from the console middleware.
- **Questions to settle:**
  1. **Production method** — keep the folder transfer, or switch to the **`cl-upload` API**?
  2. If `cl-upload`: its **spec** (auth, one or many files per call, response, errors), a **test account**,
     and who assigns the **barcode**.
  3. **Failures and repeats** — an upload failing half-way, or running twice.
  4. Does it also change how **API cases** get their documents, or only how email cases send them?
  5. Link with **attachment storage** (point 1) — where files live before and after upload.

---

## 3. Summary

- **Done:** 4 (acknowledgement); 3 inbound (Burmese diagnosis translated before the ICD-10 search);
  5 / #7 for existing internal emails (AI assessment + case link).
- **Done for now:** 3 (numbered list), 6 (inside our system).
- **Small fixes left:** saved summary for STP claims (6).
- **Needs a decision:** Burmese scope (3); email vs dashboard (5 / #8); STP rules (7).
- **Needs the iAS team / a discussion:** assessment kept in iAS (6); `cl-upload` and console upload (8, #12).
- **Later by decision:** attachment storage (1); AYAS delegation (2).
