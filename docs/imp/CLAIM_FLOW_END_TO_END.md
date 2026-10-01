# Claim Flow — End to End (Email and API cases)

How a claim moves through ULINK today, step by step: what each job reads, what it decides (AI or rule), which status
the case moves to, which emails go out, where a person can step in, and what happens on failure.

Written 2026-09-29 from the code (pipeline step order `modules/pipeline/service.js`, status catalog
`modules/case-status/catalog.js`, email templates `modules/email-sender/templates.js`, settings). Developer detail
per job: [jobs-registry.md](day1/jobs-registry.md) (email) and [api-case-workflow.md](day1/api-case-workflow.md)
(API). What changed and when: [20260917_enhancement_status.md](demo/API%20DAY1/PREV_FEEDBACK/20260917_enhancement_status.md).

**Status codes** are shown in `code` next to the label users see in the console (badge). Labels come from the status
catalog.

---

## 1. The big picture

Two ways a claim reaches us, one set of checks:

```
EMAIL CASE                                        API CASE
customer emails the claim                         a claim is created in IAS (customer used the console)
        │                                                  │
 Email intake                                      API claim intake (IAS get_claim_api)
        │                                          Console material download (the customer's images)
        ▼                                                  ▼
 ┌───────────────────────── same logic for both ─────────────────────────┐
 │ Claim recognition (AI reads every page)                                │
 │ Member check (IAS member record)                                       │
 │ Document check (checklist)                                             │
 │ Claim preparation (diagnosis, benefit, STP decision, IAS payload)      │
 └────────────────────────────────────────────────────────────────────────┘
        │                                                  │
 Console upload (cl-upload) + wait for barcode      (images are already in the console)
 IAS claim CREATION                                 IAS claim REVISION (claim already exists)
        │                                                  │
 non-STP → JD3 approves in IAS            STP → settlement report emailed to the customer
```

**How jobs connect.** No job calls another. Each job picks up the cases sitting at *its* status, works on them, and
moves them to the next status. The pipeline runs the jobs in order; a case moves as far as it can in one run and
continues on the next run. A case "waiting" at a status is normal — it is either waiting for the next run, for the
customer, for the console, for IAS, or for a person.

**Email and API cases never mix.** Every case is `source` = `EMAIL` or `API`; API cases only ever have `API_…`
statuses, so email jobs can never pick them up and the other way round (enforced by the database).

---

## 2. Email case, step by step

Pipeline order (email): email-intake → claim-recognition → *email: claim received* → member-verification →
document-checking → *email: member / documents* → console-upload → console-barcode → *email: console upload issue* →
ias-claim-preparation → ias-claim-creation → *email: JD3 / IAS rejection* → ias-claim-stp → *email: settlement report*.

### 2.1 Email intake — `email-intake`
| | |
|---|---|
| **Reads** | New messages in the claims inbox |
| **Does** | Stores the email and its attachments; also fetches documents linked in the email (e.g. `as.expa.ai` links). A reply is matched to its existing case by the email thread. |
| **Decided by** | Rule |
| **Status** | `EMAIL_RECEIVED` → `ATTACHMENTS_STORED` → `READY_FOR_DOCUMENT_READING` *Waiting to be read* |
| **Replies** | A reply **with attachments** on a case waiting for the customer (*Documents incomplete*, *Check before emailing customer*, *Member check issue*, *Needs manual reading*, *Not a claim we handle*) → the case starts again from reading, with all documents. A reply **without** attachments on *Documents incomplete* → an automatic reminder. A reply on a case that is further along (e.g. already in IAS) does not restart it. |
| **On failure** | The message stays unread and is retried next run. |

### 2.2 Claim recognition — `claim-recognition`
| | |
|---|---|
| **Reads** | `READY_FOR_DOCUMENT_READING` |
| **Does** | The AI reads every page (vision), decides which claim type it is (today one route: AYAS member claim, `ayas_member_claim`) and extracts every field (claimant, policy, claim, medical, invoices, bank). |
| **Decided by** | **AI** (with a confidence threshold) |
| **Status** | `RECOGNIZED` *Read by AI* · `MANUAL_REVIEW` *Needs manual reading* (type matched but AI not confident, or the result didn't fit the form) · `NOT_RECOGNIZED` *Not a claim we handle* |
| **Emails** | *Recognised:* **"Claim received"** to the customer (once per case). *Not recognised:* "submission not recognised" to the sender. |
| **Human** | *Needs manual reading* → review queue (reason *Unreadable*). |

### 2.3 Member check — `member-verification`
| | |
|---|---|
| **Reads** | `RECOGNIZED`, and `MEMBER_REVIEW_REQUIRED` again every run (so a fixed IAS record clears it by itself) |
| **Does** | Looks the member up in IAS by **NRC/passport + treatment date**. Compares: coverage active on the treatment date, date of birth, bank name, account holder, account number, policy number. **Every** problem is listed; the first one is the case's reason code. If the member passes: **policy exclusion check** (AI compares diagnosis/treatment with the policy's exclusion clauses) and **benefit eligibility** (is the treatment type on the member's plan). |
| **Decided by** | Rule (comparisons); **AI** (exclusion check, name judgments) |
| **Status** | `READY_FOR_DOCUMENT_CHECKING` *Checking documents* · `MEMBER_REVIEW_REQUIRED` *Member check issue* |
| **Emails** | Member check issue → **internal** "Member verification hold" (every problem + required action + AI assessment). Never to the customer. |
| **Warnings, not stops** | A possible policy exclusion or a benefit not on the plan is a **warning for JD3** — the case continues. The case page shows the clause's own words and the AI's reason. |
| **Human** | *Override and continue* (reason + finding, recorded under the reviewer's name). Not possible when the member isn't in IAS at all. |

### 2.4 Document check — `document-checking`
| | |
|---|---|
| **Reads** | `READY_FOR_DOCUMENT_CHECKING` |
| **Does** | Checklist over the extracted fields: claim form complete, mandatory fields, medical report present and legible, voucher(s) present, clear, correct, with breakdown, voucher total = claimed amount (refund / cash-return slips — zero or negative amounts — are left out of the total), bank information, and consistency across documents (patient name, hospital, dates, diagnosis vs treatment; delegation letter when someone else is paid). |
| **Decided by** | Rule, plus **AI** judgments (e.g. names written differently, medical record legible) |
| **Status** | `MEMBER_VERIFIED` *Checks passed* · `INCOMPLETE` *Documents incomplete* · `DOCUMENTS_REVIEW` *Check before emailing customer* (switch #2, below) |
| **Emails** | *Incomplete:* to the **customer** a numbered list of what is missing, with the reason under each; to the **team** "Documents incomplete" (the list + why the case went this way). Once per list of missing items. |
| **Switch #2 on** | If the AI was **unsure** about a missing item (a document it couldn't read, a date that differs from the medical record, or judged at or below 0.5 confidence): the customer is **not** emailed; the case waits at *Check before emailing customer*; the team gets "ACTION NEEDED". |
| **Human** | *Documents incomplete*: *Override and continue* (the documents are fine). *Check before emailing customer*: **send the request to the customer**, or *Override and continue*. |

### 2.5 Console upload — `console-upload`
| | |
|---|---|
| **Reads** | `MEMBER_VERIFIED` (AYAS member claims) |
| **Does** | Depends on `.env` `CONSOLE_UPLOAD_METHOD`: **`folder`** (default) copies the documents to the shared console folder and makes up a barcode → straight to *Documents uploaded*. **`cl-upload`**: checks the case number (`AYA-CL-` + 8 digits), merges all attachments into **one PDF**, uploads it by API → waits for the barcode. |
| **Decided by** | Rule |
| **Status** | `folder`: `DOCUMENTS_UPLOADED` *Documents uploaded*. `cl-upload`: `CONSOLE_BARCODE_PENDING` *Waiting for console barcode* · `CASE_NUMBER_UNCLEAR` *Case number unclear* · `CONSOLE_UPLOAD_FAILED` *Console upload refused* |
| **Emails** | Case number unclear / upload refused → internal "Console upload — …". |
| **On failure** | Network / server error → stays at *Checks passed*, retried next run. |

### 2.6 Console barcode — `console-barcode` (cl-upload only)
| | |
|---|---|
| **Reads** | `CONSOLE_BARCODE_PENDING`, and `CONSOLE_BARCODE_MISSING` (keeps checking) |
| **Does** | Asks the console middleware for the case's barcodes (`scanId = API-<case number>`). The console creates barcodes about every **15 minutes**, so this normally takes 15–30 minutes — like waiting for a food ticket to be called. When a barcode newer than our upload is there: saves **all** the case's barcodes, earliest first. |
| **Status** | `DOCUMENTS_UPLOADED` *Documents uploaded* · after 2 h without one: `CONSOLE_BARCODE_MISSING` *Console barcode not received* (still checked every run; moves on by itself if it arrives) |
| **Emails** | Not received in time → internal "Console upload — Console barcode not received" (once). |

### 2.7 Claim preparation — `ias-claim-preparation`
| | |
|---|---|
| **Reads** | `DOCUMENTS_UPLOADED` |
| **Does** | 1. **Diagnosis:** Burmese text is translated to clinical English first; ICD-10 candidates by search on the **illness text only** (drug names in the treatment text would drown the symptoms); the AI picks one with a reason, seeing the treatment too. No confident pick → `R69` (unknown). 2. **Benefit:** one IAS claim line per voucher; the AI picks the benefit type and head from the member's own plan. 3. **STP decision** by the rules (section 4.4). 4. Builds the IAS payload: claim lines, barcode(s) (`barcode` + `suppBarcode1–5`), and **`AiSummaryRemark`** (the AI assessment, up to 10,000 characters). |
| **Decided by** | **AI** (translation, diagnosis, benefit) + Rule (STP) |
| **Status** | `CLAIM_PAYLOAD_PREPARED` *Claim prepared* |

### 2.8 IAS claim creation — `ias-claim-creation`
| | |
|---|---|
| **Reads** | `CLAIM_PAYLOAD_PREPARED` |
| **Does** | Creates the claim in IAS. |
| **Status** | `CLAIM_CREATED` *Created in IAS* (claim number saved) · `CLAIM_SUBMIT_FAILED` *IAS rejected the claim* |
| **Emails** | Non-STP → internal **JD3 approval** email (claim number + AI assessment + review points). IAS rejection → internal email with IAS's reason. STP → no email here (settlement report next). |
| **On failure** | Network / server error → retried next run. A rejection from IAS (e.g. "Claim already exists") is **not** retried. |
| **Audit** | STP claims: the AI assessment is saved on the case history. |

### 2.9 Settlement report — `ias-claim-stp` (STP claims only)
| | |
|---|---|
| **Reads** | `CLAIM_CREATED` and STP |
| **Does** | Asks IAS for the claim status every run until the settlement report (CSR) is ready, downloads it. |
| **Status** | `CSR_SENT` *Settlement report sent* |
| **Emails** | The settlement report (PDF attached) to the **customer**. |
| **Audit** | The final AI assessment (the whole journey) is saved on the case history. |

A **non-STP** claim ends at *Created in IAS*: JD3 approves it in IAS. ULINK can't see that approval.

---

## 3. API case, step by step

Pipeline order (API): api-claim-intake → api-material-download → email-intake → api-reply-intake →
api-claim-recognition → api-member-verification → api-document-checking → api-claim-preparation → api-claim-revision →
api-claim-stp → api-email-sender.

Only what differs from the email case is described; the checks themselves are the same code.

| # | Step | What happens | Status (label) |
|---|---|---|---|
| 1 | **API claim intake** | Lists the claims created in IAS today (Myanmar time); one case per IAS claim number. A second IAS claim with the same TPA case number is refused (reported, not merged). | `API_RECEIVED` *Received from IAS* |
| 2 | **Console material download** | Downloads the images the customer uploaded to the console. None after **2 hours** → the customer is asked for documents. | `API_MATERIALS_DOWNLOADED` *Images downloaded* · `API_NO_DOCUMENTS` *No documents* |
| 3 | **Reply intake** | A customer reply to our email with new attachments → the case is read again (console images + new attachments). | `API_REPLY_RECEIVED` *Customer replied* |
| 4 | **Recognition** | Same as 2.2. | `API_RECOGNIZED` · `API_MANUAL_REVIEW` |
| 5 | **Member check** | Same as 2.3 (internal email on an issue). | `API_READY_FOR_DOCUMENT_CHECKING` · `API_MEMBER_REVIEW_REQUIRED` |
| 6 | **Document check** | Same checklist. Missing documents: customer emailed, and — unlike email — the case **continues** so the IAS claim can be suspended. Switch #2 on and the AI unsure: waits at *Check before emailing customer* instead. | `API_DOCUMENTS_VERIFIED` *Documents complete* · `API_INCOMPLETE` *Documents missing* · `API_DOCUMENTS_REVIEW` *Check before emailing customer* |
| 7 | **Claim preparation** | Same builder as 2.7, plus the API flags: documents missing → `isSuspense=Y`; STP → `isValidation=Y, isCSR=Y`; otherwise `N`. All the customer's console barcodes → `barcode` + `suppBarcode1–5`. | `API_CLAIM_PAYLOAD_PREPARED` *Revision prepared* |
| 8 | **Claim revision** | The claim already exists in IAS, so it is **revised** (never created). Complete + STP → settlement report next. Complete, not STP → JD3 email. Documents missing → **suspense** in IAS + internal "Documents incomplete" email; the customer's reply restarts the case and the next revision lifts the suspense. | `API_AWAITING_CSR` *Waiting for settlement report* · `API_CLAIM_REVISED` *Revised in IAS* · `API_CLAIM_SUSPENDED` *Documents incomplete* · `API_CLAIM_REVISION_FAILED` *IAS rejected the revision* |
| 9 | **Settlement report** | Same as 2.9. | `API_CSR_SENT` *Settlement report sent* |
| — | **API email sender** | Sends every email the API jobs asked for. API emails start their own thread (subject "AYA Sompo claim … (Ref: …)"); customer and internal emails are kept in separate threads. | — |

### Email vs API at a glance

| | Email case | API case |
|---|---|---|
| Starts from | Customer's email | Claim created in IAS |
| Documents come from | Email attachments | Console (customer's upload) + email replies |
| Console / barcode | We upload (`cl-upload`) and wait for the barcode — or folder copy | Already in the console; barcodes read from it |
| IAS action | **Create** the claim | **Revise** the claim |
| Documents missing | No IAS claim yet; wait for the customer | Claim **suspended** in IAS; wait for the customer |
| STP rules used | *Email* column | *API* column |

---

## 4. The decisions, explained

### 4.1 Member check
Compared with the member's IAS record: coverage active on the treatment date (reinstatement/effective date to
termination/expiry date), date of birth, bank name (abbreviations allowed, e.g. "AYA" = "AYA Bank"), account holder
(a leading title like "U" / "Daw" ignored), account number, policy number. Every mismatch is listed with both values
(dates shown as YYYY-MM-DD). Order of the main reason: coverage → DOB → bank → policy.

### 4.2 Document check
Missing or unclear items become the customer's numbered list. Items are **rules** over what the AI read, except the
judgments (legibility, names written differently, delegation) which are **AI** with a confidence.

### 4.3 Diagnosis and benefit
- Burmese diagnosis/treatment → translated to clinical English (marked *AI translated*); the IAS payload keeps the
  original text.
- Diagnosis: ICD-10 search on the illness text only + AI pick (illness and treatment) with reason. Not confident → `R69` (unknown), which never goes STP.
- Benefit: per voucher, from the member's own plan (IAS benefit types: IP inpatient, OP outpatient, DT dental,
  VS vision, PA). No confident pick → blank, which never goes STP.

### 4.4 STP (straight-through processing)
A claim goes STP only if **all** hold (console **STP settings**):
1. every line's IAS benefit type is **allowed** for this case type (Email / API);
2. the lines of each benefit type add up to **no more than its limit**;
3. every line has a benefit type;
4. the diagnosis code is **not on the never-STP list** (code or prefix; `R69` is on it);
5. switch #1 on → **no open review point** (AI unsure, possible exclusion, …).

Every block is written as the reason (e.g. "IP is not allowed for STP. (email case rules)"). A rule change applies to
claims prepared after it. STP → `isValidation=Y, isCSR=Y` in IAS and the settlement report; not STP → JD3.

### 4.5 Human checks when the AI is unsure (switches, both off by default)
| Switch (STP settings page) | On |
|---|---|
| **#1 Don't pay automatically when the AI was unsure** | Any open review point stops STP → JD3 approves. |
| **#2 Don't email the customer when the AI is unsure a document is missing** | Customer email held; *Check before emailing customer*; the team sends the request or overrides. |

Both only catch cases where the AI **knows** it is unsure. STP limits cap the risk of a "confidently wrong" case.

### 4.6 Console barcode wait
See 2.5–2.6. Normal wait 15–30 minutes; flagged after 2 hours; always keeps checking.

---

## 5. Where a person steps in

| When | Where | What the person does |
|---|---|---|
| Any case needing a person | **Review queue** (grouped by reason, oldest first) | Open the case, read "why the case went this way" and the review points |
| *Member check issue* | Case page | **Override and continue** (reason + finding) — or fix IAS; the case re-checks every run |
| *Documents incomplete* | Case page | **Override and continue** if the documents are fine |
| *Check before emailing customer* | Case page | **Send the request to the customer**, or **Override and continue** |
| *Needs manual reading*, *Case number unclear*, *Console upload refused*, *Console barcode not received* | Case page / internal email | Check and fix; *Reset* reprocesses a case from reading (not allowed once it has an IAS claim number) |
| Non-STP claim in IAS | **Approvals** page + JD3 email | JD3 approves in IAS |
| STP rules and switches | **STP settings** (super admin) | Limits, never-STP diagnoses, the two switches |

Every override is recorded in the case history with the person, the finding and the reason; the overridden points
stay visible, marked *✔ Overridden by … — why*, in the console, the emails and IAS.

---

## 6. Status catalog

| Label (console) | Code | Flow | Who acts next |
|---|---|---|---|
| Email received / Attachments stored / Waiting to be read | `EMAIL_RECEIVED` / `ATTACHMENTS_STORED` / `READY_FOR_DOCUMENT_READING` | Email | System |
| Read by AI | `RECOGNIZED` / `API_RECOGNIZED` | Both | System |
| Needs manual reading | `MANUAL_REVIEW` / `API_MANUAL_REVIEW` | Both | **Person** |
| Not a claim we handle | `NOT_RECOGNIZED` | Email | — (failed) |
| Member check issue | `MEMBER_REVIEW_REQUIRED` / `API_MEMBER_REVIEW_REQUIRED` | Both | **Person** (re-checked every run) |
| Checking documents | `READY_FOR_DOCUMENT_CHECKING` / `API_READY_FOR_DOCUMENT_CHECKING` | Both | System |
| Documents incomplete | `INCOMPLETE` (email) / `API_CLAIM_SUSPENDED` (API) | Both | **Customer** |
| Check before emailing customer | `DOCUMENTS_REVIEW` / `API_DOCUMENTS_REVIEW` | Both | **Person** |
| Checks passed / Documents complete | `MEMBER_VERIFIED` / `API_DOCUMENTS_VERIFIED` | Both | System |
| Documents missing | `API_INCOMPLETE` | API | System (→ suspense) |
| Waiting for console barcode | `CONSOLE_BARCODE_PENDING` | Email | Console (15–30 min) |
| Console barcode not received | `CONSOLE_BARCODE_MISSING` | Email | **Person** (still checked) |
| Case number unclear | `CASE_NUMBER_UNCLEAR` | Email | **Person** |
| Console upload refused | `CONSOLE_UPLOAD_FAILED` | Email | **Person** |
| Documents uploaded | `DOCUMENTS_UPLOADED` | Email | System |
| Claim prepared / Revision prepared | `CLAIM_PAYLOAD_PREPARED` / `API_CLAIM_PAYLOAD_PREPARED` | Both | System |
| Created in IAS | `CLAIM_CREATED` | Email | JD3 (non-STP) / System (STP) |
| Revised in IAS | `API_CLAIM_REVISED` | API | JD3 |
| IAS rejected the claim / revision | `CLAIM_SUBMIT_FAILED` / `API_CLAIM_REVISION_FAILED` | Both | **Person** |
| Waiting for settlement report | `API_AWAITING_CSR` | API | IAS |
| Settlement report sent | `CSR_SENT` / `API_CSR_SENT` | Both | — (done) |
| Received from IAS / Images downloaded / No documents / Customer replied | `API_RECEIVED` / `API_MATERIALS_DOWNLOADED` / `API_NO_DOCUMENTS` / `API_REPLY_RECEIVED` | API | System / Customer |

---

## 7. Email catalog

| Email | To | Sent when |
|---|---|---|
| Claim received | Customer | Claim recognised (once per case) |
| Submission not recognised | Sender | Not a claim we handle |
| Missing documents (numbered, reason per item) | Customer | Documents incomplete (API: also when there are no console images) — held when switch #2 applies |
| Reminder | Customer | Reply without attachments while documents are incomplete |
| Settlement report (PDF) | Customer | STP claim, report ready in IAS |
| Member verification hold | **Team** | Member check issue |
| Documents incomplete / Check before emailing the customer | **Team** | Documents incomplete / held by switch #2 |
| Claim ready for review (JD3) | **Team** | Non-STP claim created / revised in IAS |
| IAS rejected | **Team** | IAS rejected the claim / revision |
| Console upload — … | **Team** | Case number unclear, upload refused, barcode not received |

Team emails go to `INTERNAL_REVIEW_EMAIL` (+ the route's CC), start with "(ULINK AI)", and include the case link and
**why the case went this way** + the AI assessment. Each email type is sent once per distinct problem.

---

## 8. Where the "why" is kept

| Where | What |
|---|---|
| **Case page** | *Why the case went this way* (one line per stage, reason, where it is now) and the *AI assessment* (every decision: result, why, confidence, how checked — *Rule*, *Cross-checked*, *AI self-rated* — review points, who might be wrong) |
| **Team emails** | The same text |
| **IAS** | `AiSummaryRemark` on every claim creation and revision |
| **Audit copy** | Saved with the case: non-STP in the JD3 email; STP at claim creation and again at the settlement report |
| **Case history** | Every status change, email sent, override and reset, with who and why |

---

## 9. Settings

| Setting | Where | Default | Meaning |
|---|---|---|---|
| STP rules | Console → STP settings | Demo values | Allowed + max amount per case type (Email/API) and IAS benefit type |
| Never-STP diagnoses | Console → STP settings | `R69` | ICD-10 codes or prefixes that never go STP |
| Switch #1 / #2 | Console → STP settings | Off | Human checks when the AI is unsure (4.5) |
| `CONSOLE_UPLOAD_METHOD` | `.env` | `folder` | `folder` or `cl-upload` |
| `CL_UPLOAD_URL`, `CL_UPLOAD_API_KEY` | `.env` | — | cl-upload API |
| `CONSOLE_MIDDLEWARE_URL` | `.env` | — | Console middleware (barcodes, API images) |
| `CONSOLE_BARCODE_WAIT_MINUTES` | `.env` | 120 | Time before *Console barcode not received* |
| `API_MATERIAL_GRACE_MINUTES` | `.env` | 120 | Time to wait for an API case's console images |
| `INTERNAL_REVIEW_EMAIL` | `.env` | — | Where team emails go |
| `CONSOLE_URL` | `.env` | — | Console address used in the "Open this case" link |

---

## 10. Failures and retries

| Kind | What happens | Example |
|---|---|---|
| **Technical** (network, timeout, server error) | Case stays where it is; retried on the next run | IAS or console timeout |
| **Normal wait** | Case stays; checked every run; not an error | Barcode not ready, settlement report not ready, member record fixed later |
| **Business answer** | Case goes to a *needs review* status with the reason; **not** retried automatically | IAS rejects the claim, upload refused, case number unclear |
| **Waiting for the customer** | Case waits; a reply with documents restarts it | Documents incomplete |
| **Stuck** | *Reset* on the case page reprocesses it from reading (refused once it has an IAS claim number) | A case processed with wrong data |

A pipeline step that fails does not stop the other steps; each case is handled on its own.
