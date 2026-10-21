# ULINK Claims: reverse PRD

This document describes the system as the code builds it on 2026-10-21. It is a reverse PRD: the requirements are read back from the code, not taken from a plan. Sources are `src/ulink-console` (the web console), `src/ulink-api` (the API and the pipeline jobs) and the docs in `docs/`. Each statement that the code does not settle is marked [UNCLEAR] for the owner to decide.

## 1. What the system does

The system takes AYA Sompo member medical claims and enters them into IAS (the insurer's claim system) with as little manual work as possible. An AI reads the claim documents and checks them against the claim checklist and the IAS member record. It picks the ICD-10 code and the benefit, and it creates or revises the claim in IAS. A claim that passes every rule goes straight through (STP, straight-through processing) and the settlement report goes to the customer.

The AI can be wrong. So the system stops a case for a person in three situations: a check fails, the AI is unsure (at or below a confidence threshold), or a rule says that a person must decide. The web console is that human-in-the-loop dashboard.

Two intake flows exist side by side:

| Flow | Where claims come from | What the system does in IAS |
|---|---|---|
| Email flow | The claims mailbox (IMAP). The customer emails the claim form and documents. | Creates a new claim in IAS. |
| API flow | The IAS claim list (`get_claim_api`). The customer submitted an e-claim, so the claim already exists in IAS. The documents come from the IAS console. | Revises the existing claim in IAS (claim revision API). |

Each flow is its own pipeline of jobs. A scheduler (cron) or a person on the Pipeline page runs it. On dev today, email cases are off (`emailCasesEnabled` false) and API cases are on.

## 2. Users and roles

The code has one login role: `super_admin` (`modules/auth/auth.js`, `ROLES = ['super_admin']`). Accounts come from the command `npm run user:create`. Nobody can sign up, and a forgotten password is reset by an administrator. A session lasts 8 hours. When the browser tab closes, the session ends.

The texts in the console and the emails name business roles that the code does not model as logins:

| Business role | What the texts say this person does | Where it shows |
|---|---|---|
| Claims team (CSR / Ops) | Works the review queue: member issues, document checks, claim preparation choices, contacting the customer. | "Next:" box (`who: 'Claims team'`), team emails |
| JD3 (approver) | Approves non-STP claims in IAS. | Approvals page, "Require approval (JD3)" on Overview |
| Customer | Sends missing documents. | "Next:" box (`who: 'Customer'`) |
| Administrator | Runs the pipeline, changes STP and system settings, reads the AI performance page. | Admin section of the sidebar |

[UNCLEAR] Is one role for everybody intended? Every logged-in user is a super admin today, so every user can change settings, override checks and run the pipeline. Some API routes already allow any logged-in user (upload, retry, email draft), which suggests a second, smaller role was planned.

[UNCLEAR] JD1 and JD2 appear in older docs as the people who do the automated checks by hand. The console does not name them. Are they the claims team?

## 3. Screens

The sidebar groups the pages by how people work: Dashboard, Work and Admin. Most list pages have Email and API tabs (only the flows that are switched on show), and some have an "All" tab.

### 3.1 Login (`/login`)

Username and password. After login, the user goes to the page they asked for, or to Overview.

### 3.2 Overview (`/overview`)

Purpose: the start page for the day. It shows how many cases need whom, for one flow at a time.

It shows counts by who acts next: "Being processed", "Incomplete (waiting for documents)", "Require approval (JD3)" and "STP (paid straight through)". It also shows "Received today" and a bar chart of the claims received per day for the last 14 days. An overdue badge and the pipeline health sit beside them. If a pipeline has not run for a set number of minutes, its health turns red.

Actions: each number opens the Cases list with the matching filter.

[UNCLEAR] The code comment says "Which numbers matter most is still an open decision (design doc, decision 3)". The full daily dashboard (PRD item E6) is parked, and only option B is built.

### 3.3 Review queue (`/review`)

Purpose: every case that waits for a person, oldest first. Each row shows its most serious reason and what to check first. A count shows in the sidebar.

Actions: filter by reason or "My cases" (cases this user holds), search by claim no. or TPA case no., and open a case in the review workspace. The rules for which cases appear are in `modules/review-queue/queue.js`.

### 3.4 Approvals (`/approvals`)

Purpose: JD3's list. Non-STP claims that passed every check and are in IAS, waiting for approval, with the AI's review points for each.

Actions: search by claim no. or TPA case no., and open the case page. The approval itself happens in IAS, not in the console.

[UNCLEAR] The code comment says that the system cannot see the approval in IAS. A claim stays on the list until something moves it on. What moves an approved claim off this list? If nothing does, the list only grows.

### 3.5 Cases (`/cases`)

Purpose: every case, with search and filters. The whole view is in the URL, so Overview and other pages link to a filtered list.

Actions: search through the API by claim no., TPA case no., claimant name, NRC or case ID. Filter by flow, status group and step. Sort, page, and open a case.

### 3.6 Case page (`/cases/:id`)

Purpose: the full record of one case.

It shows the status, the claim no. and the TPA case no. The "Next:" box says what must happen now and who does it. Below it are the case journey ("why the case went this way") and the AI assessment summary with the review points. The values that the AI read come next. Then come the documents, the email threads and the timeline. A super admin also sees the technical details: raw JSON, job steps, IAS payloads and AI calls.

Actions on this page:

| Action | When it shows | Who |
|---|---|---|
| Review documents (opens the review workspace) | Always | Any user |
| Claim / release the case ("Being reviewed by …") | Always | Super admin |
| Upload missing documents | API case at `API_NO_DOCUMENTS`, `API_CLAIM_SUSPENDED`, `API_DOCUMENTS_REVIEW` or `API_DOCUMENTS_UNSURE` | Any logged-in user |
| Try again (retry) | A case that IAS or the console refused | Any logged-in user |
| Claim preparation choices (diagnosis code, voucher benefit, manual rejection) | `API_PREPARATION_REVIEW` | Super admin |
| Override and continue, or `Confirm and continue` | A member or document stop | Super admin |
| Documents are missing: continue, or send the request | `API_DOCUMENTS_REVIEW` / `DOCUMENTS_REVIEW` | Super admin |
| Request more information (reviewer's own lines) and mark a line done | Document stops | Super admin |
| Customer email draft (copy and send by hand) | Cases waiting on documents | Any logged-in user |
| Mark a correction trusted | Corrections made by another person | Super admin |
| Reset the case (read it again from the start) | Email cases | Super admin |

### 3.7 Review workspace (`/cases/:id/review`)

Purpose: one screen to check and decide. The document viewer is on the left. The AI findings are on the right: Unsure, Failed, Handled, Not checked (folded) and Passed (folded), each with its confidence, its reason and a link to its page.

Opening the page claims the case for this user. Leaving it releases the claim. "Next case" opens the oldest unclaimed case in the queue.

Actions: the "Next:" box sits at the top. "✓ Right" records that the AI read a value right, as learning data. Edit, Mark OK and Mark wrong on a finding make a correction, saved with a reason and "What went wrong?". The page also has the same panels as the case page: retry, claim preparation, override, request more information and the corrections made. At the claim preparation stop, one "Save all and check again" button saves the corrections and the choices together.

[UNCLEAR] The case page and the review workspace both carry the claim preparation, override and corrections panels. Which page is the place to decide? A reviewer can act on either.

### 3.8 Pipeline (`/pipeline`)

Purpose: run and watch the jobs of one flow.

It shows a canvas with every job in order, its status in the current run, and email badges next to the jobs that send email. If the customer missing-documents email is off, the API badges say who gets the email instead.

Actions: "Run Automation" (a full run), and on a job or email badge, "Run this step" (a run with only that job). The detail panel shows the step's rows.

### 3.9 STP settings (`/stp-settings`) and System settings (`/system-settings`)

One page component with two views.

STP settings: per flow and benefit type (IP, OP, DT, VS), whether STP is allowed and the amount limit. The never-STP diagnoses list: ICD-10 code prefixes with notes, which hold ULINK's chronic list since 2026-10-21. Switches: `stpBlockOnReviewPoints`, `vitaminsBlockStp`.

System settings: the AI confidence threshold (default 70%) and the switches that hold a case for a person (`holdUnsureDocumentPass`, `holdUnsureMissingDocsEmail`, `holdUnsureDiagnosis`, `holdUnsureBenefit`, `holdUnsureVitamin`). It also has `usePastCorrections`, the flow switches (`emailCasesEnabled`, `apiCasesEnabled`, `mailboxEnabled`) and `apiSendMissingDocumentsEmail`. Its numbers are the voucher date limit, the overdue limit in working days, and the minutes before the Overview shows a pipeline as stale.

Actions: change and save. If one value on the form is not valid, the API saves nothing.

[UNCLEAR] The seeded STP amount limits are marked "DEMO values … not business rules" in the migration. What are ULINK's real limits?

### 3.10 AI performance (`/ai-performance`)

Purpose: how each prompt version does: calls, time, tokens, confidence, and how often the AI was unsure. The page also has a feedback report of every correction, "✓ Right" and override, with a CSV download.

[UNCLEAR] The page is hidden from the sidebar since 2026-10-19 but still opens by its address. Is it for ULINK or only for the developers?

## 4. Main tasks, step by step

### 4.1 An API claim goes straight through (no person)

1. Claim intake lists the new claims in IAS and creates an API case for each.
2. Material download takes the documents from the IAS console and stores them as a PDF.
3. Claim recognition reads every page with the AI and extracts the fields.
4. Member verification compares the member, policy and bank details with IAS.
5. Document checking runs the checklist and scores how sure the AI was.
6. If a person uploaded documents on the case page, console upload and console barcode send them to the IAS console. Otherwise these jobs do nothing.
7. Claim preparation picks the ICD-10 code and the benefit for each voucher, applies the STP rules, and decides the suspense flag.
8. Claim revision sends the revision to IAS.
9. If the claim is STP, claim STP waits for the settlement report and emails it to the customer. If not, the claim waits for JD3 on the Approvals page.

The full chart with every stop is in `docs/system/flowchart/API_CASE_FLOWCHART.md`.

### 4.2 Clear a member check issue

1. The case appears in the review queue as "Member check issue". The team gets the email "Member verification hold".
2. The reviewer opens the case and compares the document, IAS and the customer's details.
3. If IAS is wrong, the reviewer fixes IAS. The case is checked again on every run.
4. If the AI misread a value, the reviewer corrects the value. The case goes back to the member check.
5. If the difference is acceptable, the reviewer marks the finding OK or overrides the check with a reason.

### 4.3 Handle missing documents (API case)

1. The document check finds a missing or unclear document.
2. If the AI was sure, the claim is revised in IAS with a suspense, and the case waits at `API_CLAIM_SUSPENDED`.
3. If the AI was unsure, or a person had corrected items, the case waits at `API_DOCUMENTS_REVIEW`. The reviewer checks the documents and either continues as missing (suspended revision) or overrides the check (documents complete).
4. With the customer email off, ULINK emails the customer itself, using the draft on the case page.
5. When the documents come in, a user uploads them on the case page, or they appear in the IAS console.
6. The case is read and checked again from claim recognition. When the documents are complete, the next revision lifts the suspense.

### 4.4 Decide what the AI was unsure of in claim preparation

1. If the AI was unsure of the diagnosis code, a voucher's benefit, or the vitamins on a voucher, the case stops at `API_PREPARATION_REVIEW`.
2. The reviewer opens the review workspace. The "Next:" box names what to decide.
3. If a document value is wrong, the reviewer corrects it on the right side.
4. The reviewer chooses the ICD-10 code, by autocomplete on the code or words, or by a search by meaning. The reviewer chooses the benefit type and head for each flagged voucher, sets any manual rejection for supplements, and writes a comment.
5. One save sends everything. With corrections, the case is checked again from the document check, and claim preparation then uses the saved choices.

### 4.5 Approve a non-STP claim (JD3)

1. The claim is revised in IAS and appears on the Approvals page with the AI's review points. JD3 gets the email "Claim ready for review".
2. JD3 opens the case and reads the assessment.
3. JD3 approves the claim in IAS.

### 4.6 Change the rules

1. An administrator opens STP settings or System settings.
2. The administrator changes a limit, a never-STP code or a switch, and saves.
3. The next pipeline run uses the new values.

## 5. Emails

| Email | To | Sent by (API flow) | Notes |
|---|---|---|---|
| Member verification hold | Team | Member verification | Subject names the claim no. for API cases. |
| Check before the customer is asked | Team | Document checking | When the case waits at `API_DOCUMENTS_REVIEW`. |
| Missing documents | Customer | Material download, document checking | Not sent while `apiSendMissingDocumentsEmail` is off. With no images at all, the team gets it instead. |
| Documents incomplete | Team | Claim revision | When the claim is suspended. |
| Claim ready for review | Team | Claim revision | Non-STP claim revised in IAS. |
| Claim submit issue | Team | Claim revision | IAS refused the revision. |
| Settlement report | Customer | Claim STP | STP claims, with the report attached. |

The email flow also sends "Claim received" and "Not recognised" to the customer, and "Console upload issue" to the team. API cases send no "Claim received" email (owner, 2026-10-21).

Each team email ends with the full AI assessment and a link to the case.

## 6. Unclear, inconsistent or unfinished

### 6.1 Product decisions to confirm

- [UNCLEAR] One login role for everybody (section 2).
- [UNCLEAR] How a claim leaves the Approvals page (section 3.4).
- [UNCLEAR] The real STP amount limits (section 3.9).
- [UNCLEAR] Who the AI performance page is for (section 3.10).
- [UNCLEAR] Which page is the place to act: the case page or the review workspace (section 3.7).
- [UNCLEAR] Customer emails for API cases all go to one fixed address (`API_CASE_CUSTOMER_EMAIL`). A comment in `config/index.js` says that the real address will come from the member's IAS record later. Until then, no real customer gets an API email.
- [UNCLEAR] Team emails are long: the full assessment has 15 to 20 decisions. A short format (result, changes by a person, points to check) is proposed and not built.
- [UNCLEAR] The supplement referral list (Montelukast and brand names, `docs/imp/CR/SYSTEM_4/PRD/supplement_referral_list_plan.md`) is on hold until ULINK explains why it referred Montelukast, a prescription medicine.
- [UNCLEAR] The overdue limit is 2 working days "until ULINK sets it".
- [UNCLEAR] Blocked PRD items wait for ULINK input: E4-16, E4-13, E4-18 (questions Q6, Q15, Q18, Q19).

### 6.2 Behavior that looks inconsistent

- A failed document check with an unsure value is not held. If documents are missing and the AI is sure, the code skips the unsure-item hold, because `unsurePassedPoints` runs only on a pass. So an unsure value, such as a misread voucher date, can go to IAS in the suspended revision without a person.
- The benefit picker writes its whole reasoning into the reason, and on the vision sample its pick (SPFRM) did not match its own conclusion (SPEC). The schema asks for the pick before the reason.
- The never-STP codes B19.10 and B19.11 can never match today. Claim preparation picks codes only from the system's copy of the IAS list, and that copy has no ICD-10-CM codes.
- `POST /api/dev/cases/reset` accepts only email statuses, but `docs/imp/day1/api-case-workflow.md` says it resets API cases too.
- `API_DOCUMENTS_UPLOADED` and `API_UPLOAD_NOT_IN_CONSOLE` are still in the code for older cases. The code comment says to remove them later.
- `api-reply-intake` (customer replies by email for API cases) stays callable but is not in the API pipeline. API cases get their documents by upload or from the console only.
- Plain-text team emails can lose line breaks in Outlook, so numbered lines run together.

### 6.3 Unfinished or not proven

- Most SYSTEM_4 items are "Done, awaiting review" in `docs/imp/CR/SYSTEM_4/PRD/SYSTEM_4_PRD.md` section 8, and many were not checked in a browser (BACKLOG N3).
- The live check of cl-upload (sending case-page uploads to the IAS console) is still open (BACKLOG N4). Questions for the console team are open too (C2: file order, size limit, production switch-over).
- The job routes `/api/jobs/*` need no login, so anyone who can reach the API port can run a pipeline (BACKLOG B9). This must be closed before production.
- The full daily dashboard (E6) and the work-queue extras (E2b) are parked.
- The never-STP chronic list is ULINK's list as of 2026-10-21. Autoimmune codes count as chronic only under immunomodulatory therapy, which a code cannot show, so those claims always go to a person.
