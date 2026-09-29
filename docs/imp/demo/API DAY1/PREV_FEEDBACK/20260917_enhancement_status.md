# 17/09 Meeting — Enhancement Status

Source: `Ulink_AI_Claims_Automation_Meeting_Summary_Action.docx` (same folder), "Key Discussion Points".
Status checked against the system on 2026-09-29 (evening).
Related: [MEETING_20260917_ACTION_STATUS.md](MEETING_20260917_ACTION_STATUS.md) (action items),
[SUMMARY_REQUIREMENT.md](SUMMARY_REQUIREMENT.md), [CONSOLE_DASHBOARD_DESIGN.md](CONSOLE_DASHBOARD_DESIGN.md).

**This file is the tracker for system changes from the 17/09 meeting** — status per point (sections 1–3),
what is still missing (section 4) and a dated change log (section 5). The related files are background;
where they disagree, this file is current (e.g. `MEETING_20260917_ACTION_STATUS.md` still lists #7, #10, #11
as open; `SUMMARY_REQUIREMENT.md` still lists its steps 6 and 7 as open — both done).

Legend: ✅ done · 🟡 partly done · 🔴 not started / minimal · ⏸ later (by decision) · 🗣 to discuss

---

## 1. Overview

| # | Meeting point | Status | Next |
|---|---|---|---|
| 1 | Attachment storage | ⏸ Later | Discuss later |
| 2 | AYAS delegation rule | ⏸ Later | Waiting for the AYAS exception list |
| 3 | Customer communication | 🟡 Numbered list done; Burmese not | Decide Burmese scope |
| 4 | Acknowledgement trigger | ✅ Done | Check live in the demo rehearsal |
| 5 | Internal review | 🟡 Review queue, JD2 email, AI summary + case link + "why the case went this way" in internal emails and console; internal email for incomplete documents; switch to hold the customer email when the AI is unsure | Decide email vs dashboard for the rest (#8); whether to switch the hold on |
| 6 | AI assessment history | ✅ Saved in our system (STP + non-STP) and sent to iAS (`AiSummaryRemark`) | Check it in iAS on the next submission |
| 7 | STP governance | 🟡 Configurable rules built (demo); switch "open review point blocks STP" | Real values + decisions from Ulink (incl. whether to switch on) |
| 8 | API / integration | 🟡 API case workflow built; `cl-upload` for email cases built (off by default) | Live check with `AYA-CL-26031486`, then switch on |
| — | Console upload (action #12) | 🟡 Built for email cases (`cl-upload`, off by default) | Live check, then switch on; open questions in C2 |

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
- ✅ **Member check reports every problem (A2, built 2026-09-29)** — before, only the first failure was named
  (a DOB mismatch hid a bank mismatch). Now the reason lists each one (numbered), the member-issue email
  lists every reason code and its SOP action (subject "… (+1 more)"), and the override panel's payment-risk
  warning shows whenever a bank mismatch is among them. The first problem still decides routing.
- ✅ **"Why the case went this way" (meeting notes item 5, built 2026-09-29)** — every case (email and API)
  shows its path, one line per stage with the result and the reason: received → recognised → member check →
  documents → diagnosis → benefit → STP → IAS → where it is now (and who acts next). On the case page (panel
  above the AI assessment) and at the top of the AI assessment in every internal email (member issue,
  documents incomplete, JD2 approval, IAS rejection). Built from stored results, no extra AI call
  (`assessment-summary/journey.js`). The STP audit snapshot is now also refreshed when the settlement report
  is sent, so it covers the whole journey.
- ✅ **Internal email when documents are incomplete (meeting notes item 4, built 2026-09-29)** — "(ULINK AI)
  Documents incomplete — Case/Claim … — N missing": what the customer was asked for, the case link, why the
  case went this way and the AI assessment. Sent once per missing-documents list. Email cases: with the
  customer's missing-documents email (`DOCUMENTS_INCOMPLETE` task). API cases: when the claim is revised in
  IAS with suspense. Covered by decision #8 — easy to switch off if Ulink says "dashboard only".
- ✅ **Human checks when the AI is unsure (built 2026-09-29, two switches, both off by default)** — console
  STP settings → "Human checks when the AI is unsure": **#1** a claim with an open review point never goes STP
  (goes to JD2, reason shown); **#2** when the AI is unsure a document is missing (couldn't read it, or below 0.5
  confidence) the customer's missing-documents email is held — status **Check before emailing customer**, team
  email "ACTION NEEDED"; the person sends the request or overrides (email and API cases). Covers B3's "open
  review point blocks STP" as a switch Ulink can turn on.
- ❌ No internal email yet for the remaining attention cases (AI couldn't read the documents, AI unsure) — see #8.
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
- ✅ **STP** claims keep a saved copy too (built 2026-09-29), taken when the claim is created / revised in
  IAS — the point the STP decision is final: email cases on the `CLAIM_CREATED` case event (`rawRef`),
  API cases in the `api-claim-revision` step output (`assessment`). Not shown in the console (audit only).
- ✅ **Sent to iAS (built 2026-09-29)** — new IAS field `AiSummaryRemark` (top level, optional, up to 10,000
  characters, line breaks and Burmese allowed — confirmed by the IAS team) on the claim submission (email cases) and
  the claim revision (API cases): the same text as the internal emails (why the case went this way, review points,
  decisions), as the case stands when sent. Longer text is cut at 10,000 with a note. A real case is ~4,200 characters.
- Detail: [SUMMARY_REQUIREMENT.md](SUMMARY_REQUIREMENT.md).

### 7. STP governance — 🟡 configurable rules built for the demo (2026-09-29)
- ✅ **Console → Admin → STP settings**: per **case type (Email / API)** and **IAS benefit type**
  (IP / OP / DT / VS, the `BenefitType` sent to IAS): STP allowed yes/no + max amount (MMK). Plus a
  **never-STP diagnosis list** (ICD-10 code or prefix, e.g. `C`); **R69** (diagnosis not found) is on it,
  which closes the `AYA-CL-26034912` gap. Tables `ulink_stp_rules`, `ulink_stp_blocked_diagnoses`
  (replace `ulink_stp_limits`); logic `ias-claim-preparation/stpEligibility.js`.
- A case is STP only if every line's benefit type is allowed and its total for that type is within the
  limit, and the diagnosis isn't blocked. A line with no benefit type, or a type with no rule (e.g. **PA**,
  seen in IAS data), is not STP. The AI assessment's STP line gives the reason.
- Seeded amounts are demo values (email: OP 50,000 / DT 30,000 / VS 30,000; API: OP 100,000 /
  DT 50,000, VS off; IP off for both). Editing is super admin only; a change applies to claims prepared after it.
- **Asked:** STP must not rely on amount alone; configurable rules (amount, diagnosis, AI confidence, others).
- **Before 2026-09-29:** amount only (total ≤ 50,000 MMK per route, table `ulink_stp_limits`, now removed).
  Real example of the risk: `AYA-CL-26034912` went STP with a **defaulted diagnosis (R69, AI confidence 0)** —
  now blocked by R69 on the never-STP list.

**Suggested plan**

| Phase | What | Status |
|---|---|---|
| 1. Safety rules | Not STP if: diagnosis **defaulted** ✅ (R69 on the list); a line has **no benefit type** ✅; **any open review point** (AI unsure, data mismatch, unreadable) ❌; a person **overrode** a check ❌ | Last two wait for Ulink's decision |
| 2. Configurable | ✅ Console STP settings: allowed + amount per case type and IAS benefit type; never-STP diagnosis list. ❌ switches for the phase-1 rules; ❌ history of rule changes (who / when) | Demo-ready; history needed for production |
| 3. AI confidence rule | Only once override / accuracy data shows which confidence is really trustworthy (the AI can be confidently wrong) | Needs real review data |

**Decisions for Ulink:** real amounts per case type and benefit type · diagnoses that must never be STP ·
should **PA** (5th IAS benefit type seen in the data) ever be STP · should "any open review point" or an
override block STP · who can change the rules.

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
  5 / #7 internal emails (AI assessment, case link, "why the case went this way", incomplete-documents email,
  every member problem listed, policy exclusion explained); 6 (saved in our system and sent to iAS as
  `AiSummaryRemark`).
- **Done for now:** 3 (numbered list).
- **Built for the demo:** 7 (STP settings in the console); human checks when the AI is unsure (two switches,
  off by default: open review point blocks STP; hold the customer email when the AI is unsure);
  8 / #12 console upload by API (`cl-upload`) for email cases, off by default.
- **Before the demo:** run the migrations (`npm run db:migrate`), restart; rehearse with the switches set as they
  will be demoed ([ULINK_Demo_Rundown.docx](../ULINK_Demo_Rundown.docx)); check the STP settings page, the journey
  panel and the "send the request" button in a browser.
- **Parked by decision:** history of STP rule changes (A1, 29/09).
- **Needs a decision:** Burmese scope (3); email vs dashboard (5 / #8); real STP values, PA, whether to switch on
  the two human checks, who edits (7).
- **Needs the console team:** open `cl-upload` questions (C2).
- **Later by decision:** attachment storage (1); AYAS delegation (2).

---

## 4. Still missing (as of 2026-09-29)

**A. We can build now — no decision needed**

| # | What | Point | Size |
|---|---|---|---|
| A1 | ⏸ **Parked (not needed for now, 29/09)** — history of STP rule changes: who changed which rule, when, before → after; "Recent changes" on the STP settings page | 7 | Small (½ day) |
| ~~A2~~ | ~~Member check reports every problem, not just the first~~ — ✅ done 2026-09-29 (see change log) | 5, 6 | — |

**B. Waiting on a Ulink decision**

| # | What is missing | Decision needed | Point |
|---|---|---|---|
| B1 | Internal email for "Needs manual reading" (the AI couldn't read the claim at all). Built 2026-09-29: incomplete documents email; documents the AI was unsure about → held for the team (switch #2) | Which cases email CSR/Ops vs dashboard only (#8); confirm the incomplete-documents email is wanted | 5 |
| B2 | Burmese outbound emails | Full email or missing-documents part; approved wording | 3 |
| B3 | Real STP values; PA; who edits. "Open review point blocks STP" is built as a switch (off) — only whether to turn it on | Final STP parameters | 7 |
| B4 | Random audit sample of STP claims | Audit % (e.g. 5–10%) | 6, 7 |
| B5 | Reviewer actions on the dashboard (confirm / correct, beyond override) | Who can act, what they may correct, does iAS update | 5 |
| B6 | AYAS delegation — different bank-account holder as a payment rule | AYAS exception list (Dr KP / Ulink) | 2 |
| B7 | Attachment storage location and retention | Ulink + DRT/IT (later by decision) | 1 |

**C. Needs the iAS team**

| # | What is missing | Needed | Point |
|---|---|---|---|
| ~~C1~~ | ~~AI assessment kept in iAS~~ — ✅ built 2026-09-29 (`AiSummaryRemark`) | — | 6 |
| C2 | 🟡 **Built 2026-09-29 for email cases, switched off by default** — see [console_upload_requirement.md](../CL-UPLOAD%20SPEC/console_upload_requirement.md). Document upload by API (`cl-upload`, 3rd demo). **First spec received** (`CL-UPLOAD SPEC/console-upload-spec.md`): POST multipart `TpaCaseNumber` + one merged PDF, API key; barcode not returned — fetched later from `/api/barcodes?scanId=API-<case>` | **Answered:** barcode in 15–30 min (console job every 15 min; our limit 2 h); upload at `api.ulink.ins-link.com/cl-upload`, barcode lookup at the console middleware (`localhost:3023`); failures / repeats handled (requirement R7). **Still open:** are `-01`/`-02` always created in upload order; upload size limit (a real case merges to 11 MB); when to switch production from the folder copy | 8, #12 |

**D. Later — needs data first**

| # | What | Needs |
|---|---|---|
| D1 | Accuracy report — how often each AI decision is corrected, per confidence band | Reviewer actions (B5) running for a while |
| D2 | STP rule on AI confidence | D1 |

---

## 5. Change log

| Date | Point | Change |
|---|---|---|
| 2026-09-28 | 3 | Numbered missing-documents email; Burmese diagnosis translated before the ICD-10 search |
| 2026-09-28 | 4 | "Claim received" email sent once, right after claim recognition |
| 2026-09-28 | 5 | Review queue, Approvals page, override and continue; AI assessment + "Open this case" link in internal emails |
| 2026-09-28 | 6 | AI assessment on every case; saved for non-STP claims (JD2 email) |
| 2026-09-29 | 7 | Configurable STP rules: console **Admin → STP settings** — per case type (Email / API) + IAS benefit type (IP/OP/DT/VS): allowed + max amount; never-STP diagnosis list (R69 seeded). Tables `ulink_stp_rules`, `ulink_stp_blocked_diagnoses` replace `ulink_stp_limits`; API `/api/stp-settings` (edit: super admin) |
| 2026-09-29 | 6 | AI assessment saved for STP claims too (email: `CLAIM_CREATED` event `rawRef`; API: `api-claim-revision` output `assessment`) |
| 2026-09-29 | — | Tests: JD2 email test updated to the current wording; Jest limited to `tests/` (`openapi/spec.js` no longer run as a test). Full suite passes (225/225) |
| 2026-09-29 | 5 | Member check reports every problem, not just the first (`member-verification/checks.js` → `issues` list; numbered reason; member-issue email lists every reason code + SOP action; override panel warns on any bank mismatch). First problem stays the `reasonCode` — routing unchanged. Applies to cases checked from now on. Tests 228/228 |
| 2026-09-29 | 5 | Member-check reasons show dates as YYYY-MM-DD on both sides (IAS DOB and coverage period were raw `12031990` / `20260901`), in the case page, AI assessment and member-issue email. Tests 229/229 |
| 2026-09-29 | 5 | **"Why the case went this way"** (meeting notes item 5): per-case path with the reason at each stage, on the case page and at the top of every internal email's AI assessment, email and API cases (`assessment-summary/journey.js`). STP audit snapshot refreshed at settlement report (email: `CSR_SENT` event `rawRef`; API: `api-claim-stp` output `assessment`) |
| 2026-09-29 | 5 | **Internal "Documents incomplete" email** (meeting notes item 4): new internal task type `DOCUMENTS_INCOMPLETE` (migration `20260929110000`); email cases with the customer's missing-documents email, API cases at the suspense revision. Tests 233/233 |
| 2026-09-29 | 5 | **Possible policy exclusion explained**: was only "Possible match with exclusion clause 6.22" (tagged "Rule hold"). Now shows the clause's own words, the AI's one-line reason (new claims; the exclusion judge now returns it), that it is only a warning for JD2 (the case is not stopped), and a "Policy check" step in "why the case went this way". Older cases get the clause words from the policy clause list |
| 2026-09-29 | 5 | **Fix:** email cases with incomplete documents got stuck at "Checking documents" — the new `DOCUMENTS_INCOMPLETE` email type was allowed in the DB but not in the `EmailTask` model, so the document check's save failed and rolled back. Added to the model; the pipeline's document-check email step now also sends it in the same run; regression test `emailTaskTypes.test.js`. Status label "Waiting for documents" renamed **"Documents incomplete"** (email `INCOMPLETE`, API `API_CLAIM_SUSPENDED`). Tests 242/242 |
| 2026-09-29 | 6 | **AI assessment sent to iAS**: `AiSummaryRemark` (top level, ≤ 10,000 chars) added to the claim submission and revision payloads, built in `ias-claim-preparation` for both flows (`aiSummaryRemark.js`); includes overrides. Tests 245/245 |
| 2026-09-29 | 8 | **Console upload by API (`cl-upload`) for email cases** — upload one merged PDF, then wait at the new status **Waiting for console barcode** until the console creates it (its job runs every 15 min); all the case's barcodes go to IAS as `barcode` + `suppBarcode1`–`5`; case number checked first; after 2 h → *Console barcode not received* (needs review, internal email, still checked). Off by default (`CONSOLE_UPLOAD_METHOD=folder`). New dependency `pdf-lib`; migration `20260929120000`. Details: `CL-UPLOAD SPEC/console_upload_requirement.md`. Tests 260/260 |
| 2026-09-29 | 5, 7 | **Human checks when the AI is unsure** — two switches on the STP settings page, both off by default (table `ulink_settings`, migration `20260929130000`): #1 open review point blocks STP; #2 hold the customer's missing-documents email when the AI is unsure (new statuses `DOCUMENTS_REVIEW` / `API_DOCUMENTS_REVIEW` "Check before emailing customer"; `POST /api/cases/:id/release-missing-documents`; override from the held status, API override revised as complete). Demo run-down updated. Tests 271/271 |

