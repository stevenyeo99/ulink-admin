# PRD — System Enhancement 4 (API go-live, confidence gate, human-in-the-loop)

| | |
|---|---|
| Status | **Draft for review — this enhancement batch, before the next demo.** No development started. Implemented phase by phase (section 8), no target dates in this document. |
| Date | 2026-10-14 |
| Sources | `demo_feedback.md` (02-Oct-2026 notes), `ULINKxDRT API Claim Submission Demo Summary 02102026.docx`, `Vundick_feedback_20261014.md` |
| Change log | `4rd_system_enhancement_log.md` (same folder) |

## 1. Background

The 02-Oct-2026 demo showed an API case end to end: claim created in IAS, documents taken from the IAS console, AI
checks, STP, settlement email. ULINK now wants to **go live with API cases first**: email cases are on hold, and **no
inbox (IMAP) is connected** at go-live. ULINK staff will contact customers about missing documents themselves.

The feedback has three themes:

1. **API-only go-live:** switch off what depends on email, and give staff a way to add missing documents.
2. **Confidence gate:** when the AI is not sure, a person decides; no claim passes the document check or goes STP on a
   low-confidence finding.
3. **Human-in-the-loop:** people can correct every checklist item, every decision keeps a comment, and those
   corrections are kept so the AI can be improved.

## 2. Goals and non-goals

**Main focus (owner, 2026-10-14)**
1. **Human review and correctness** — the AI never decides alone when unsure; people can correct any finding
   (E4-07 … E4-12).
2. **System learns from feedback** — reviewer corrections are kept and reused on future cases (E4-15).
3. **Clear dashboard to operate API cases daily** (E4-19, E4-18) and a console built for claim users to receive,
   check and decide cases quickly (E4-20 … E4-25).

**Goals**
- API cases can run in production with email cases and the inbox switched off, without failing pipeline runs.
- An incomplete API case can be completed from the console (upload → re-check), not only by an email reply.
- No STP and no "documents complete" when any checklist item is at or below the confidence threshold.
- Every human correction is recorded per checklist item, with who, when and why.

**Decisions**
- **Data retention (owner, 2026-10-14):** no retention limit for now — corrections (E4-15) and the AI call log
  (E4-26) are kept. Access is limited to the roles in section 3. Revisit before production if ULINK / AYA Sompo
  require one.

**Non-goals (this release)**
- IAS remark preview (02-Oct item 1): handled on the IAS side.
- Retraining (fine-tuning) the local model in this release. The AI learns from reviewers through stored, trusted
  corrections it reuses; fine-tuning is a possible later step (see E4-15).
- Freshdesk integration (separate track, after the sandbox demo).

## 3. Users

| User | Uses it for |
|---|---|
| CSR / Ops (claim users) | Daily dashboard and work queue; review workspace: check and correct AI findings, upload missing documents, comment on every action |
| Supervisor | Assigns cases (if Q21 = assign); reviewer and AI-quality stats |
| JD3 | Approvals of non-STP claims; marks corrections **trusted** so the AI may learn from them (Q17) |
| Super admin | Settings (sources on/off, confidence threshold, STP rules, never-STP diagnoses); Technical tab on the case page |

Roles are proposed; final split in Q17.

## 4. Requirements

Priority: **P1** go-live blocker · **P2** needed before production STP · **P3** improvement.
Size: XS < 0.5 day · S ≈ 1 day · M ≈ 2–4 days · L ≈ 1 week+.

### Batch 1 — API-only go-live

#### E4-01 Switch Email / API cases on or off — P1, S
Source: Vundick 1, demo 7.
- **Now:** both pipelines always available; every console page opens on the Email tab.
- **Requirement:** two settings, *Email cases enabled* and *API cases enabled* (super admin, STP settings page; both
  default on). When a source is off:
  - its pipeline does not run, from cron or from the console button (the run is shown as skipped, with the reason);
  - its tab is hidden on the work pages (Overview, Cases, Review queue, Approvals, Pipeline); with one source on,
    the tab bar is hidden;
  - pages open on the first enabled source;
  - the **STP settings** page keeps both rule tabs, so Email STP rules can be prepared before email goes live
    (decision D1, 2026-10-14).
- **Acceptance:** with Email off, a cron trigger of the email pipeline does nothing and records why; no page shows an
  Email tab; existing email cases are untouched and reappear when switched back on.

#### E4-02 Run without an inbox — P1, XS
Source: Vundick 2.
- **Now:** the inbox reader (`email-intake`) is a step of the API pipeline; with no IMAP configured it fails every run.
- **Requirement:** when IMAP is not configured on the server, the inbox step is skipped with the reason "inbox not
  configured"; the API pipeline completes normally.
- **Added 2026-10-14 (A1b, owner):** setting *Read the mailbox (IMAP)* (STP settings, default on). Off: the inbox
  step is skipped with "mailbox switched off (STP settings)" — no `.env` edit or restart; useful when two
  environments share one mailbox. Sending email is not affected.
- **Added 2026-10-14 (owner):** with the mailbox not read (switch off or no IMAP), the API pipeline's **Email Reply
  Intake** (api-reply-intake) is skipped too — the API pipeline runs without both mail steps at go-live; one switch
  brings them back.
- **Acceptance:** API pipeline run with no IMAP settings ends `COMPLETED`, the inbox step shows SKIPPED.

#### E4-03 Missing-documents email to customer: switch off — P1, S
Source: Vundick 2.
- **Now:** when documents are incomplete or no console images arrive, the customer is emailed the missing-documents
  list automatically.
- **Requirement:** setting *Send missing-documents email to customer* (default on). When off:
  - the customer email is not sent; the case history says "missing-documents request left to ULINK (manual)";
  - the internal team email (missing-documents list, `(ULINK AI) ` prefix) is still sent so staff know whom to contact;
  - the IAS revision with suspense still happens as today;
  - **no console images at all** (`API_NO_DOCUMENTS`): today only the customer email exists, so with the switch off
    the team gets an internal email instead ("no documents received — contact the customer") (decision D3,
    2026-10-14).
- **Scope:** API cases only (setting *API cases: send missing-documents email to customer*). Covers every source of
  that email — document check, no console images, reply reminders, and releasing a held email.
- **Acceptance:** with the switch off, an incomplete API case is suspended in IAS, the team gets the internal email,
  the customer gets nothing, the case page shows why.
- **Open:** Q3 (is outgoing email/SMTP on at all at go-live?).

#### E4-04 Upload missing documents on the case page → re-check — P1, M
Source: Vundick 3. Also fixes the gap E4-02 creates: with no inbox, a suspended API case can never resume.
- **Now:** an API case only receives more documents by a customer email reply.
- **Requirement:**
  - On an API case waiting for documents (*No documents*, *Documents incomplete* (suspended), *Check before emailing
    customer*), a user can upload one or more files (PDF / image) with a comment.
  - The upload is added to the case's documents (kept with uploader and time; the original documents stay).
  - The case then runs AI reading, member check and document check again on all its documents, the same way an email
    reply does today, and continues: complete → claim revised in IAS (suspense lifted) → STP or JD3 approval.
  - The case history shows the upload and the new results.
- **Acceptance:** an `API_CLAIM_SUSPENDED` case with an uploaded medical report is re-checked on the next pipeline run
  and, if complete, revised in IAS without suspense.
- **Answered 2026-10-14 (owner):** Q1 yes — uploads go to the IAS console; Q2 all users; Q5 yes — revise IAS
  automatically; Q12 only while waiting on documents (no documents, or a documents check).
- **Built 2026-10-14 (E1, as recommended):** (1) new API job **api-console-watch** (before the download): a case waiting
  on documents (*No documents*, *Documents incomplete* / suspended, *Check before emailing customer*, *Check the AI's
  documents finding*, *Uploaded — waiting for the console*, *Upload not in the console*) whose console scan has a
  submission it doesn't have yet → `API_NEW_DOCUMENTS` → api-material-download fetches only the new images → read,
  member check, document check, preparation, revision (suspense lifted when complete). Works for documents put in
  the console by anyone (owner's point), not only our upload. (2) **Upload documents** on the case page (any user,
  comment required): 1–10 PDF/JPG/PNG, ≤ 20 MB, merged into one PDF, sent through cl-upload with the TPA case number
  → `API_DOCUMENTS_UPLOADED`; not in the console after 2 h (`CONSOLE_BARCODE_WAIT_MINUTES`) →
  `API_UPLOAD_NOT_IN_CONSOLE` (needs review, still watched). Refused by cl-upload → the reason, case unchanged; network
  failure → try again, unchanged. Needs `CL_UPLOAD_URL` / `CL_UPLOAD_API_KEY`. No migration.

#### E4-05 Deploy Burmese translation — P1, XS
Source: demo 8.
- **Now:** Burmese diagnosis / treatment text is translated to English before the ICD-10 search (built, not yet in
  UAT).
- **Requirement:** release to UAT and production.
- **Open:** Q8 (does "Burmese support" also mean console or email wording?).

#### E4-06 Load chronic-illness never-STP diagnoses — P1, XS (data only)
Source: ULINK input 5.
- **Now:** STP settings already has a never-STP diagnosis list.
- **Requirement:** enter ULINK's list (e.g. HTN, DM) on the STP settings page. No development.
- **Depends on:** ULINK providing the ICD codes.

#### E4-19 API daily operations dashboard — P1, M
Source: owner, 2026-10-14 (main focus 3).
- **Now:** the Overview shows status counts per source; work is spread over Review queue, Approvals and Cases.
- **Requirement (proposed, to confirm with ULINK — Q20):** one start page for the day's API work:
  - **Needs action now**, by kind, each linking to the filtered list: AI unsure (documents / member check), waiting
    for documents (upload, E4-04), waiting for JD3 approval, failed / needs technical attention.
  - **Ageing:** how long each waiting case has waited; oldest first; cases over an agreed limit highlighted.
  - **Today:** received, completed, STP, sent to JD3, suspended, failed.
  - **Pipeline health:** last API pipeline run, its result, next scheduled run.
- **Acceptance:** a CSR can start the day from this page and reach every case that needs them in one click.

### Batch 2 — Confidence gate

#### E4-07 One confidence threshold setting — P1, S
Source: Vundick 4.
- **Now:** "unsure" means confidence below **0.5**, fixed in code (assessment summary, medical-record check).
- **Two kinds of threshold in the code today (both 0.5):**
  - *Send to a person* — review points in the assessment summary, holding the missing-documents email. **These use
    the setting.**
  - *Answer usable at all* — identity judgment, diagnosis pick (falls back to R69), benefit pick, policy exclusion
    judge, medical-record presence: below it the AI's answer is dropped. **These stay at 0.5** — raising them would
    drop more answers (fewer policy-exclusion flags = less safe) (decision D4, 2026-10-14). An answer between 0.5
    and the setting is kept, and counts as unsure.
- **Requirement:** setting *AI confidence threshold* (super admin, STP settings page), default **70%** (decision D2,
  2026-10-14). A finding **at or below** it is "unsure" (Vundick: "<= 70%"; answers Q4 for the comparison).
- **Acceptance:** changing the setting changes which findings are unsure on the next run; no "send to a person"
  threshold remains in code.

#### E4-08 Confidence score and reason on every AI output — P1, M
Source: Vundick 4; owner, 2026-10-14: "anything that is returned by the AI should have a confidence score and reason"
(answers Q13 — not only the document checklist).

**Rule:** every answer the AI (LLM) gives carries a **confidence score** (0–100%) and a **reason** in plain words —
whether the result is positive or negative — and both are stored with the result and shown where the result is shown.
A checklist item decided by a rule on AI-extracted data takes the confidence of the data it used.

**Now — every place the AI answers:**

| Step | AI output | Confidence | Reason | Gap |
|---|---|---|---|---|
| Claim recognition | Route: claim type / insurer, or not recognised | Yes | Yes | — |
| Claim recognition | Page reading (OCR by the vision LLM, one page per call) | No | Only `unclear` marks | Mark doubtful characters / words (e.g. a 7 that may be a 1) so the mapping step can carry them into field confidence — the mapping step never sees the image and cannot judge reading certainty itself |
| Claim recognition | Field mapping from page text (claim form, member, bank, vouchers, dates, amounts, diagnosis…) | Only medical report / voucher present | Only those two | **Main gap:** per-field confidence and reason |
| Claim recognition | Vitamin / supplement per voucher | No | No | Add, which items (E4-10) |
| Document check | Name / provider / hospital match, diagnosis–treatment, delegation payee | Yes | Yes | — |
| Document check | Other checklist items (claim form complete, voucher clear / correct / breakdown, medical report readable, bank info, mandatory fields) | No | Only when failed | Take confidence from the fields used; reason on pass too |
| Member check | Name comparison with IAS (LLM when not an exact match) | Yes | Yes | — |
| Member check | Policy exclusion match | Yes | Yes | — |
| Claim preparation | Burmese → English translation | Yes | No | Add reason (what was unclear) |
| Claim preparation | Diagnosis (ICD-10) pick | Yes | Yes | — |
| Claim preparation | Benefit pick | Yes | Yes | — |

Results by plain rules or IAS data (date arithmetic, amount totals, IAS member found, STP rules) are not AI answers:
they show the rule and its result as the reason, and are certain unless they use AI-read data (then as above).

- **Requirement:**
  - Fill every gap in the table.
  - Every extracted field and finding also returns its **source document and page**, so the review workspace
    (E4-20) can open it. Page level only — highlighting the exact spot is not reliable with the current model.
  - Show score and reason on the case page next to each result (checklist, member check, diagnosis, benefit, route).
  - Every score feeds the confidence gate (E4-09); unsure items are listed in the AI summary / IAS `AiSummaryRemark`.
  - A new AI step added later must return both (added to the pipeline-change checklist).
  - **Format checks** on extracted values, as rules next to the AI's confidence: NRC format, policy / member number
    format, valid dates (not in the future, not before policy start), voucher lines adding up to the voucher total.
    A value that fails a format check is unsure whatever the AI's score.
- **Note:** the AI scores itself, so scores are not calibrated; E4-15 step 3 tunes thresholds from reviewer
  corrections.
- **Acceptance:** no AI result on the case page is shown without a score and a reason.

#### E4-09 Unsure never passes the document check or STP — P1, S
Source: Vundick 5, demo 3.
- **Now:** a *failed* unsure item can hold the case (switch, currently off). A *passed* unsure item only blocks STP
  when the "review points block STP" switch is on; the document check still passes.
- **Requirement:** any checklist item at or below the threshold — pass or fail — sends the case to *Check before
  emailing customer* / documents review for a person. It cannot reach "documents complete" or STP until a person
  confirms or corrects it (E4-12).
- **Acceptance:** a case whose items all pass but one is at 65% stops at documents review; it is not STP.
- **Built 2026-10-14 (B1, decisions as recommended):** switch #3 *Documents the AI passed but wasn't sure about: a
  person confirms first* (STP settings, default off). New statuses `DOCUMENTS_UNSURE` / `API_DOCUMENTS_UNSURE`
  *Check the AI's documents finding* (needs review, Review queue reason "AI unsure"), no email. The person
  **confirms** (new finding "Checked: the AI's reading is right", offered only here) → `MEMBER_VERIFIED` /
  `API_DOCUMENTS_VERIFIED`; the confirmed points no longer block STP. Switches #1 and #2 kept (Q9). Limit: no "mark
  incomplete" from here until per-item correction (E4-12).
- Replaces the need to turn on the two existing human-check switches; decide whether they remain (Q9).

#### E4-10 Vitamins / supplements → manual approval — P2, S (flag) / M (per item)
Source: demo 5.
- **Now:** the AI already reads, per voucher, whether any item is a vitamin or supplement. Nothing uses it.
- **Requirement:** a voucher with vitamins/supplements is a review point and blocks STP (switch on the STP settings
  page); the claim goes to JD3 approval with the reason shown.
- **Later (with E4-17):** list the vitamin lines and their amount so they can be rejected while the rest is paid.
- **Built 2026-10-14 (B2, decisions as recommended):** switch *Vitamins / supplements: a person approves (no STP)*,
  **default on**. The document check adds one checklist line (*Vitamins / supplements*: found on voucher n / none /
  couldn't tell) — never an issue, so the documents still pass. Found → review point "Vitamins / supplements" and STP
  reason "Vitamins / supplements on voucher n — a person approves" → JD3. Couldn't tell → "AI unsure" point only
  (switch #1 decides). Whole claim to JD3; rejecting only the vitamin amount waits for E4-17.
- **Depends on:** ULINK vitamin/supplement sample case.

### Batch 3 — Human-in-the-loop

#### E4-11 Comment on every manual action — P1, S
Source: Vundick 6, demo 2.
- **Now:** a check override needs a finding code and a reason.
- **Requirement:** every manual action — override, per-item correction, upload, releasing or editing a customer
  email, approval — asks for a comment; stored with user and time; shown in the case history.
- **Built 2026-10-14 (C3, decisions as recommended):** the case actions that had none now require a comment (at least
  3 characters; the API answers 400 without one): *Send the request to the customer* ("What did you check?") and
  *Reset* ("Why?"). Kept in the case history ("… — comment: …"); for an API case also on the `case-review` step.
  Override / confirm already required finding + reason. Upload (E1) and per-item correction (E4) get one when built.
  Still super admin only (Q17). **Follow-up (not built):** a reason and a change history for STP settings saves —
  needs a settings-history table (migration); approvals happen in IAS, outside this system.

#### E4-12 Override or correct each checklist item — P1, M
Source: Vundick 8, demo 4.
- **Now:** a person overrides a whole check (all document points or all member points) at once.
- **Requirement:**
  - Per checklist item: mark it pass / fail, and where it is a value (e.g. invoice date, amount, patient name) enter
    the correct value; reason required (E4-11).
  - The corrected result is what the rest of the flow uses: document check outcome, assessment summary, IAS
    `AiSummaryRemark`, STP.
  - The AI's original finding stays visible next to the correction.
- **Acceptance:** correcting one wrong invoice date lets the case continue; the case page and the IAS remark show the
  AI value, the corrected value and who corrected it.

#### E4-13 Editable missing-documents email before sending — P3, S–M
Source: Vundick 7.
- **Now:** a held email can be sent as written (super admin), not edited.
- **Requirement:** when the AI is unsure, the customer email is prepared from the approved template; the user can
  edit the body, then send. Both the AI draft and the version sent are kept.
- **Open:** Q3. If ULINK sends these emails by hand at go-live (E4-03 off), this waits for email to go live.

#### E4-14 Override feedback report — P3, S
Source: demo 2.
- **Requirement:** a list / CSV export of all corrections and overrides: case, checklist item, AI finding and
  confidence, human decision, comment, user, date. Filter by date and item.

#### E4-15 AI learns from human review — P1 (steps 0–1) / P2 (steps 2–4) / P3 (step 5)
Source: Vundick 6 — "when a human is in the review loop, the AI learns for future cases".

**How the AI works today.** Two steps, both on the local LLM (LM Studio):
1. **Reading (OCR):** each PDF page becomes an image; the vision LLM reads **one page per call** and writes out its
   text, marking what it cannot read as `unclear` (`transcribe-page.md`). No separate OCR engine.
2. **Mapping:** a text-only LLM call maps all page texts into the claim fields (`route-decision.md`,
   `extract-fields.md`); it never sees the images. Rules and a few LLM judgments (names, provider,
   diagnosis–treatment) then make the checklist.

**How it learns.** Reviewer knowledge is kept **in our database, not inside the model**: each trusted correction is
looked up and reused the next time a similar item comes up. This works with the local model as it is, keeps the
"why" traceable ("decided like case X, corrected by JD3"), can be undone by removing one row, and survives a change
of model — the knowledge is not lost when the LLM is upgraded or replaced. Retraining the model (fine-tuning) is
possible with a local model, but is the last step, only if the data shows it is needed.

**Principle — human review drives accuracy; prompts change only on evidence.** Human review is the source of truth
and the safety net, but on its own the same mistakes are corrected every week. Each correction must change
something: a lookup, a threshold, retrieved examples, or — when the data points to it — the prompt. No prompt is
changed because of a single bad case; a change is made for an item with a high override rate and kept only if the
test set shows it helped.

**Trusted only.** A correction is used for learning only after a senior user (e.g. JD3) marks it trusted — a wrong
correction would otherwise teach the mistake.

| Step | What | When | Technology |
|---|---|---|---|
| 0. Safety | Unsure → a person decides (E4-07, E4-09) | Go-live | Confidence threshold setting |
| 1. Capture | Per-item correction + comment + trusted mark (E4-11, E4-12): checklist item, AI value and confidence, human value, reason, document page, **which step was wrong** (reading the page vs mapping the fields), user, date | Go-live | Postgres table (`ulink_ai_feedback`) |
| 2. Measure | Override rate per checklist item (E4-14); corrected cases become a test set, rerun before any prompt/model change; every AI call logged with prompt version and model (E4-26) | From the first month | SQL report; test script; `ulink_llm_calls` |
| 3. Cheap fixes | Exact values / aliases (provider "PHH" = "Pun Hlaing Hospital", name spellings) looked up before the LLM is asked; per-item thresholds set from how often the AI was overridden at each confidence; **provider hints** — the same hospital / clinic uses the same voucher layout, so trusted corrections are kept per provider (e.g. "dates written DD/MM; total bottom right") and given to the reading step for that provider's documents; a targeted prompt change when one item's override rate stays high | An item is corrected repeatedly | Postgres lookup tables keyed by provider (`pg_trgm` for near-spellings); SQL statistics |
| 4. Retrieval (correction memory) | For judgment items (diagnosis–treatment, supplement) **and extracted fields**, the 3–5 most similar trusted corrections — same checklist item / field, same provider first — are added to the prompt as past reviewer decisions; the result records which ones were used | An item's override rate stays high after step 3 | pgvector + nomic embedding (already used for ICD-10), filtered by item and provider |
| 5a. Multimodal retrieval | Similar past page images (handwriting, layouts) retrieved as examples | Only if the test set shows text retrieval does not fix reading errors | Image embedding model in LM Studio + pgvector; applies to the reading step only; reading is one page per call because several images in one call caused multi-minute hangs, so example images bring that risk back |
| 5b. Fine-tuning | Retrain the local model on trusted corrections | Only if the test set shows steps 3–4 no longer help, and there are hundreds of trusted examples | LoRA / QLoRA (Unsloth, Hugging Face PEFT/TRL or Axolotl) on a GPU machine → GGUF → loaded in LM Studio as a new model version, re-tested on the test set |

- **This release:** steps 0–2. **Phase 2:** steps 3–4. **Phase 3 (if needed, test set decides):** step 5a / 5b.
- **Success measure (agree with ULINK):** the override rate per checklist item falls over time, while low-confidence
  findings still go to a person.

### Batch 4 — Needs ULINK input / dashboard

#### E4-16 Correct the AI summary / reviewer checklist — P2, size TBD
Source: demo 4. Needs ULINK's list of wrong or missing lines on the case page / IAS remark.

#### E4-17 Manual reject: Reject Code, Rejected Amount, Reject Remark — P2, M–L
Source: demo 6.
- **Now:** nothing.
- **Open:** Q6. Blocked on ULINK's sample of how they enter a manual rejection, and on whether the IAS API accepts
  these fields.

#### E4-18 Combined Email + API dashboard — P3, S–M
Source: demo 7.
- **Meaning (owner, 2026-10-14):** one view combining Email and API cases.
- **Requirement:** an **All** tab, first and default, next to Email and API:
  - **Overview:** status counts (received, needs review, waiting on customer, in progress, done, failed) adding up
    both sources, each count split Email / API.
  - **Cases, Review queue, Approvals:** one list across both sources, with a Source column and filter — staff work
    one queue instead of switching tabs.
  - **Pipeline** and **STP settings** stay per source (two separate pipelines; STP rules are set per source).
- With E4-01, only enabled sources are included; with one source enabled, the All tab is not shown.
- Low value while only API is live (Q19).

### Batch 5 — Operations console for claim users

Target user: claim operations (CSR / Ops / JD3) receiving and checking cases daily. Principle: one screen where the
user checks the AI's answer against the document and decides — not more charts. Proposed by DRT, 2026-10-14; to
confirm with ULINK.

#### E4-20 Review workspace: document and AI findings side by side — P1, M–L
- **Now:** the case page stacks documents, emails, history, checklist and raw JSON; checking one finding means
  scrolling between the document and the checklist.
- **Requirement:**
  - **Left:** document viewer — page thumbnails, zoom, rotate.
  - **Right:** AI findings grouped by check — unsure first, failed next, passed collapsed; each with confidence,
    reason and source page (E4-08). Clicking a finding opens its page on the left.
  - Each finding: **Accept / Correct (enter value) / Reject**, comment required — this is where E4-11 / E4-12 are done
    and E4-15 feedback is captured.
  - **Next case** button: saves and opens the next case in the user's queue.
  - Raw JSON, job steps and IAS payloads move to a **Technical** tab, shown to super admin only.

```
┌ API-26100012 · Aung Aung · OP · 32,500 MMK · Needs review: 2 unsure ──── [Next case ▸] ┐
├──────────── Document viewer ───────────┬──────────── AI findings ─────────────────────┤
│ [p1][p2][p3] thumbnails                 │ ⚠ Unsure first                               │
│                                         │  Invoice date  12/09 ≠ report 17/09   62%   │
│   page 2 (zoom / rotate)                │  "7 may be read as 1" · p2                   │
│                                         │  [✓ Accept] [✎ Correct: ____] [✗ Reject]     │
│                                         │ ✓ Passed (collapsed)                         │
│                                         │  Patient name  matches IAS           95%  p1│
│                                         │ Member · Diagnosis J06.9 88% · Benefit OP   │
└─────────────────────────────────────────┴──────────────────────────────────────────────┘
```
- **Acceptance:** a reviewer can check and decide every unsure finding of a case without leaving the screen or
  scrolling to find the document.

#### E4-21 Case header: why it is here, what to do — P1, S
- **Requirement:** the top of every case shows TPA case number, claim number, member, benefit, amount, source,
  status, and **one line of next action** (e.g. "AI unsure about invoice date — check page 2, then accept or
  correct"), built from the existing journey / assessment summary (no LLM call).
- **Acceptance:** a user knows what to do on a case without reading the history.
- **Built 2026-10-14 (C1, decisions as recommended — case page only; no list column yet; English):** case header
  shows claimant name, benefit type(s), claimed amount, received / updated, and a **Next** box — one sentence per
  status from `assessment-summary/nextAction.js` (rules over the status, open review points with confidence, STP
  reasons, the last event's message, the missing-documents setting), with who acts (Claims team / JD3 / Customer);
  amber when a person must act. Returned as `nextAction` on `GET /api/cases/:id`.

#### E4-22 Work queue: ownership, ordering, search — P1, M
- **Requirement:**
  - **Claim / assign** a case ("Being reviewed by …"); while claimed, others can view but not correct it. Prevents
    two people correcting the same case. Released on decision, by the user, or after a time-out.
  - **Ordering:** oldest / over the ageing limit first (Q20); filter by reason (documents, member, approval, waiting
    for upload); **My cases** view.
  - **Global search** in the top bar: TPA case number, claim number, member name, NRC.
- **Open:** Q21.

#### E4-23 One confidence look everywhere — P2, S
- **Requirement:** one badge used on queue, case page and dashboard: green at or above the threshold, amber unsure,
  red failed — always the number and the reason (on hover / tap), never colour alone.
- **Built 2026-10-14 (C2):** `ConfidenceBadge` (console) — "62% · unsure" (amber, at or below the threshold read from
  the STP settings), "85% · sure" (green), "92% · issue" (red, the result itself failed); hover gives the threshold. Used
  wherever a confidence is shown today: the assessment lines and the document checklist. Lists and the dashboard pick
  it up when they show confidences (E2, E6). No console test runner — checked by type-check and lint.

#### E4-24 Single case timeline — P2, S–M
- **Requirement:** AI steps, human actions (who, what, comment), IAS calls, uploads and emails in one dated list on
  the case page — answers "who changed what and why" for audits and disputes.

#### E4-25 Reviewer and AI-quality stats — P3, S
- **Requirement:** on the dashboard (supervisors): cases reviewed per person, average review time, override rate per
  checklist item (the E4-15 success measure — shows which AI checks need work).

#### E4-26 AI call log and prompt versioning — P2, S–M
Source: DRT, 2026-10-14 (evaluation / observability).
- **Now:** AI results are stored per job step, but not which prompt version or model produced them, nor duration.
- **Requirement:**
  - Every AI call recorded in `ulink_llm_calls`: case, step, prompt name and version, model, duration, result,
    confidence, retrieved examples used (E4-15 step 4), error.
  - Prompts carry a version; a prompt change is a new version.
  - The test set (E4-15 step 2) reports accuracy per item per prompt / model version, so a change is kept only if it
    helps.
- **Data:** medical and personal data stays on our servers. Langfuse (LLM tracing UI) is an option later, **self-hosted
  only** (needs ClickHouse, Redis and object storage besides Postgres) — never the cloud service.
- **Acceptance:** for any AI result on a case, we can tell which prompt version and model produced it.
- **Built 2026-10-14 (D1, decisions as recommended):** table `ulink_llm_calls` (migration
  `20261014100000-create-llm-calls`, run on dev). Written in one place, the AI client (`postChatCompletion`; size
  refusals in `synthesizeJson`), so every chat call is logged — page reading (`vision`) and every text call — with
  status ok / error / timeout / too_long. Case and job come from `forCase()` set where each job starts on a case
  (`runApiJob` for all API jobs; claim-recognition, member-verification, document-checking, ias-claim-preparation).
  Prompt name = its `prompts/*.md` file, version = first 12 hex of the text's SHA-256 (automatic — most of D2).
  Stored: the AI's answer and its confidence, tokens; not the input text or images; embeddings not logged; no
  retention limit. A failed log write never breaks the call. Console: technical details → *AI calls*
  (`GET /api/cases/:id/llm-calls`).
- **Built 2026-10-14 (D2, decisions as recommended):** console page **AI performance** (Admin, super admin only;
  `GET /api/llm-calls/summary`) — one row per prompt and version: in use from–to, calls by status, average time,
  tokens in / out, average confidence, share at or below the threshold; the version on the server marked *current*,
  prompts with no calls listed. Read-only; no migration.

#### E4-27 Long documents: token budget — P1, S
Source: owner, 2026-10-14 (context-limit concern: documents differ in format and length).
- **Now:** reading is one page per call (max 800 output tokens per page) — safe. Mapping joins **all** page texts
  into one call; the only limit is 60 pages (API flow), up to ~48k tokens plus prompt and answer. No token check.
  The context length is set in LM Studio; depending on its overflow setting it may silently cut the middle of the
  text, and the AI then maps fields without some pages.
- **Requirement:**
  - Log the token size of every mapping call (E4-26) to learn real claim sizes.
  - LM Studio: context length set explicitly; overflow set to **stop with an error**, never truncate (server
    setting, recorded in `OPERATIONS.md` / deployment runbook).
  - Before mapping, estimate tokens; budget = context − prompt − answer − retrieved examples (E4-15). Over budget →
    manual review with the reason "documents too long". Never truncate.
  - Retrieved examples capped (3–5, short) and counted in the budget.
  - **Only if measurements show long claims are common:** label each page while reading (claim form / medical
    report / voucher / ID / other) and give each field group only its pages; map vouchers one at a time and merge.
- **Acceptance:** a claim over budget goes to manual review with the reason; no mapping call is ever truncated.
- **Built 2026-10-14 (B3, decisions as recommended):** `LLM_CONTEXT_TOKENS` (30976, the LM Studio model's context) and
  `LLM_OUTPUT_RESERVE_TOKENS` (6000). Every text call estimates its size before sending (characters: Latin ≈ 3.5 a
  token, Burmese / non-Latin one per character); over budget → `DocumentsTooLongError`, nothing sent. Claim recognition
  (route decision + field extraction; email and API) turns it into *Needs manual reading* with reason
  `DOCUMENTS_TOO_LONG` — "Documents too long for the AI: about N tokens, limit M. A person reads them." Each
  whole-claim call logs `LLM call size`. API 60-page rule kept. LM Studio overflow → *Stop at limit*: documented in
  `OPERATIONS.md`, server change for the owner. Splitting long claims only if the logged sizes show it's needed.

**Not proposed:** bulk approve (risky for claims), mobile layout, per-user custom dashboards.

## 5. New settings (summary)

| Setting | Default | Item |
|---|---|---|
| Email cases enabled | on | E4-01 |
| API cases enabled | on | E4-01 |
| Send missing-documents email to customer | on | E4-03 |
| AI confidence threshold | 70% | E4-07 |
| Vitamins/supplements block STP | on | E4-10 |
| Ageing limit (case highlighted as overdue) | to agree, e.g. 2 working days (Q20) | E4-19, E4-22 |
| Case claim time-out (released if no action) | to agree, e.g. 30 min (Q21) | E4-22 |
| Read the mailbox (IMAP) | on | E4-02 (A1b) |
| Inbox | from server config (IMAP set or not) | E4-02 |

Go-live (production) values: Email off, API on, mailbox off, missing-documents email off.

## 6. Open questions

| # | Question | For |
|---|---|---|
| Q1 | ~~Uploaded documents (E4-04): only for our AI check, or also uploaded to the IAS console against the claim barcode?~~ **Answered:** yes, also to the IAS console. | ULINK |
| Q2 | ~~Who may upload / override (CSR, Ops, JD3, super admin)?~~ **Answered:** all users. | ULINK |
| Q3 | Is outgoing email (SMTP) on at go-live? Acknowledgement, settlement report (CSR) and team emails depend on it. What Reply-To address should customers see? | ULINK |
| Q4 | ~~Threshold: "≤ 70%" or "< 70%"?~~ **≤** (Vundick). One for all items for now; per item later from data (E4-15 step 3). | ULINK |
| Q5 | ~~After an upload re-check finds documents complete, revise the IAS claim automatically (lift suspense), as the email reply route does?~~ **Answered:** yes. | ULINK |
| Q6 | Manual reject: entered in our console and sent to IAS, or entered in IAS directly? Does the IAS API take the fields? | ULINK / IAS |
| Q7 | Policy Event / Member Event examples: what should the system do with them? | ULINK |
| Q8 | Burmese support: only diagnosis translation, or also console / email wording? | ULINK |
| Q9 | ~~Keep the two existing human-check switches once E4-09 makes unsure always go to a person?~~ **Kept** (2026-10-14): #1 still guards STP for unsure member / diagnosis / benefit results. | DRT |
| Q10 | Go-live: is Batch 1 enough, or must Batch 2 (confidence gate) be in too? Without it STP can run on low-confidence findings. Target date? | ULINK |
| Q11 | Which ULINK team / mailbox gets the internal "documents incomplete" email and contacts the customer (E4-03)? | ULINK |
| Q12 | ~~Upload (E4-04) only while the case waits for documents — not after JD3 approval or STP?~~ **Answered:** only while waiting on documents (no documents / documents check). | ULINK |
| Q13 | ~~Confidence threshold: document checklist only, or also member check and diagnosis / benefit pick?~~ **Answered 2026-10-14:** every AI output (E4-08). | ULINK |
| Q14 | Workload at 70%: measure on past cases how many would go to review at 50 / 60 / 70% before fixing the number? | DRT → ULINK |
| Q15 | Vitamins (E4-10): whole claim to JD3, or only the vitamin amount rejected and the rest paid (needs E4-17)? | ULINK |
| Q16 | A corrected value (E4-12, e.g. invoice date, amount): update the IAS claim fields, or only the AI remark and our decision? | ULINK |
| Q17 | Roles: who may correct items, who marks a correction trusted (JD3?), who changes settings? | ULINK |
| Q18 | Editable email (E4-13): still needed while ULINK emails customers by hand, or only when email cases go live? | ULINK |
| Q19 | Combined dashboard (E4-18): needed at go-live, or when email cases go live? Any figures beyond status counts (STP rate, waiting time, override rate)? | ULINK |
| Q20 | Daily API dashboard (E4-19): which figures and lists do CSR / Ops / JD3 need each day? Ageing limit (e.g. 2 working days)? | ULINK |
| Q21 | Work queue (E4-22): does each reviewer claim cases themselves, or does a supervisor assign them? Claim time-out? | ULINK |

## 7. Inputs needed from ULINK

1. Sample cases: IP, DT, VS, Vaccination (STP rules per benefit).
2. Vitamin / supplement sample (E4-10).
3. Manual rejection sample (E4-17).
4. Policy Event and Member Event examples (Q7).
5. Chronic-illness ICD codes not to go STP (E4-06).
6. Corrections to the AI summary / checklist (E4-16).
7. Answers to section 6.

## 8. Implementation plan (kept in sync with implementation)

Order: easiest first, dependencies kept. One phase (Phase E: one sub-item) at a time:
**approved by the owner → implemented → reviewed and committed by the owner → next.**
The *Status* column is updated in this document at each step, with a dated row in `4rd_system_enhancement_log.md`
and the owner's tracker (`docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md`). When the
implementation differs from a requirement, the requirement in section 4 is updated in the same change.

Status values: Not started · Approved · In progress · Done (awaiting review) · Committed · Blocked (reason).

**Every phase ends with:** `ulink-api` tests pass; `ulink-console` builds; `CLAIM_FLOW_END_TO_END.md` /
`OPERATIONS.md` updated where behaviour changes; log and tracker rows; a suggested commit message and file list.
**Never inside a phase without a separate go-ahead:** deploying to UAT, LM Studio server changes, IAS calls,
sending email, changing data in a shared DB.

| Phase | Items | Effort | What it improves | Needs first | Status |
|---|---|---|---|---|---|
| **A. Switches and quick wins** | E4-02 no inbox, E4-01 Email/API on/off, E4-03 missing-documents email off, E4-07 threshold setting; E4-05 Burmese (release), E4-06 chronic ICD (data entry) | ≈ 3–4 days | API cases run alone, without inbox or failing runs; staff email customers themselves; one adjustable threshold | — (Q3 wording only); ICD list for E4-06 | **Done — awaiting review** (A6 blocked on ULINK's ICD list) |
| **B. Confidence gate** | E4-09 unsure never passes, E4-10 vitamins → review / no STP, E4-27 token budget | ≈ 3 days | Nothing unsure, no vitamin claim, no over-long claim goes STP or passes unchecked | Q4, Q9 (Q14 optional) | **Done — awaiting review** (B1, B2, B3) |
| **C. Console basics** | E4-21 case header next action, E4-23 confidence badge, E4-11 comment on every action | ≈ 3–4 days | Users see why a case is here and what to do; every action explained | — | **Done — awaiting review** (C1, C2, C3) |
| **D. Measurement baseline** | E4-26 AI call log + prompt versions (migration `ulink_llm_calls`) | ≈ 2–3 days | Every AI answer traceable to prompt and model; "before" numbers for E3 | — | **Done — awaiting review** (D1, D2, D3; run the baseline on UAT) |
| **E1. Upload → re-check** | E4-04 | M | Incomplete API case recovers without an inbox | Q1, Q2, Q5, Q12 | **Done — awaiting review** |
| **E2. Work queue** | E4-22 claim / assign, ordering, search | M | No two people on one case; oldest first; find any case fast | Q21 | Not started |
| **E3. Confidence everywhere** | E4-08 confidence + reason + source page on every AI output (prompt changes, checked against D) | M | Every AI answer explained, with its page | D done | Not started |
| **E4. Per-item correction** | E4-12 + E4-15 steps 0–1 (migration `ulink_ai_feedback`, trusted mark) | M | Reviewers fix single findings; corrections stored for learning | E3; Q16, Q17 | Not started |
| **E5. Review workspace** | E4-20 | M–L | Check and decide next to the document page, one screen, Next case | E3, E4 | Not started |
| **E6. Daily dashboard** | E4-19 | M | One start page for the day's API work | Q20 | Not started |
| **F. Learning** | E4-24 timeline, E4-14 feedback report, E4-15 steps 2–4, E4-25 stats | M–L | Fewer repeat mistakes, proven by override rate and test set | Weeks of trusted corrections | Not started |
| **Blocked** | E4-16, E4-17, E4-13, E4-18 | — | — | ULINK (Q6, Q15, Q18, Q19, E4-16 list) | Blocked (ULINK input) |

### Items per phase

Ticked when the item is done; the phase status above changes when all are done and reviewed.

**Phase A — Switches and quick wins** (approved 2026-10-14; decisions D1–D4 as recommended)
- [x] A1 · E4-02 Skip the inbox step when IMAP is not configured (both pipelines; step SKIPPED "inbox not configured")
- [x] A1b · E4-02 *Read the mailbox (IMAP)* switch on the STP settings page (owner, 2026-10-14)
- [x] A2 · E4-01 Email / API cases on/off — settings, pipeline guard (cron + button), console tabs and page default
- [x] A3 · E4-03 API missing-documents customer email off — skip with case event; team email for no-documents cases
- [x] A4 · E4-07 Confidence threshold setting (default 70%, ≤) for review points and held emails
- [x] A5 · E4-05 Burmese translation — nothing to build: committed 2026-09-28 (`821bf66`), already in the AWS UAT deploy commit; the local edits there are line endings only
- [ ] A6 · E4-06 Chronic never-STP ICD list — owner enters on STP settings (**blocked: ULINK list**; no code)
- [x] A7 · Tests, console build, docs (`CLAIM_FLOW_END_TO_END.md`, `OPERATIONS.md`, `.env.example`), log, tracker

**Phase B — Confidence gate**
- [x] B1 · E4-09 Passed but unsure → *Check the AI's documents finding*, a person confirms (switch #3; Q9: keep #1, #2)
- [x] B2 · E4-10 Vitamins / supplements → review point, blocks STP (switch, default on)
- [x] B3 · E4-27 Token budget before mapping → manual review if over (30976 / 6000); LM Studio overflow = stop documented (owner's server change)
- [x] B4 · Tests, docs, log, tracker (with each item)

**Phase C — Console basics**
- [x] C1 · E4-21 Case header with next action (claimant · benefit · amount; Next box, who acts)
- [x] C2 · E4-23 One confidence badge (assessment lines, document checklist)
- [x] C3 · E4-11 Comment required on every manual action (send request, reset; override already had one)
- [x] C4 · Tests, build, docs, log, tracker (with each item)

**Phase D — Measurement baseline**
- [x] D1 · E4-26 `ulink_llm_calls` migration + logging in the LLM client (+ case page *AI calls*; prompt version automatic)
- [x] D2 · Prompt versions on every prompt (automatic, from D1) + **AI performance** page: per prompt version — calls by status, avg time, tokens, avg confidence, unsure share; 7 / 30 days / all time; super admin
- [x] D3 · Baseline report `npm run report:baseline` (read-only, no AI calls) → `baseline_<date>.md`; dev has 1 case — run on UAT for real numbers

**Phase E — Main features** (each sub-item approved on its own)
- [x] E1 · E4-04 Upload missing documents → re-check: console watch (any uploader) + case-page upload via cl-upload (Q1, Q2, Q5, Q12 answered)
- [ ] E2 · E4-22 Work queue: claim / assign, ordering, search (Q21)
- [ ] E3 · E4-08 Confidence + reason + source page on every AI output; format checks
- [ ] E4 · E4-12 Per-item correction + E4-15 steps 0–1 (`ulink_ai_feedback`, trusted mark) (Q16, Q17)
- [ ] E5 · E4-20 Review workspace
- [ ] E6 · E4-19 Daily API dashboard (Q20)

**Phase F — Learning**
- [ ] F1 · E4-24 Single case timeline
- [ ] F2 · E4-14 Feedback report
- [ ] F3 · E4-15 steps 2–4: test set, lookups / provider hints, correction memory (pgvector)
- [ ] F4 · E4-25 Reviewer and AI-quality stats

**Recommended go-live:** not before phase B, and with E1 (upload) — without the inbox an incomplete API case has
no other way to recover (Q10).
