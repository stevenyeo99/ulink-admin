# SYSTEM_5 PRD: AI checklist page

Owner: Steven Yeo. Written: 2026-10-26. Status: draft for owner review.

## 1. Background

The system runs two sets of checks on every claim, in the email flow and in the API flow. The member check compares the claim with the member's IAS record. The document check looks at the claim form, the vouchers, the medical record and the bank details.

Today these checks live only in the code. The owner and ULINK staff cannot see the full list, what each check does, or what a reviewer can do about each one. A check also cannot be switched off without a code change and a release.

## 2. Goals and non-goals

Goals:

1. A super admin can see every check that the system runs, in plain words, on one page.
2. For each check, the page shows what it does and whether it can stop a case. It also shows whether the check uses the AI and what a reviewer can do about it.
3. A super admin can switch a check off and on, with a reason. The system records who changed it and when.
4. A check that is off never looks like a pass. Reviewers, emails and the IAS remark show it as turned off.

Non-goals:

1. Changing what a check does, its wording, or its limits. This page only shows checks and switches them.
2. Adding new checks. A new check is a separate change. When it is built, it appears on this page.
3. Switches for each hospital, product or policy. One switch is global for all cases.
4. Changing what a reviewer can correct. The page only shows the current rules.

## 3. Users

| User | Use |
|---|---|
| Owner and super admins | Read the list, switch checks off and on |
| ULINK operations and reviewers | If Q5 allows, read the list (read-only) to understand why a case stopped |

## 4. Requirements

### 4.1 Where the page is

A new item *AI checklist* goes in the console sidebar under *Admin*, after *System settings*. The address is `/ai-checklist`. Only a super admin can open the page and change a switch, the same as the settings pages. The API refuses everyone else.

### 4.2 What the page shows

The page is written for the owner, ULINK staff and developers. A short introduction at the top explains the two steps: the member check, then the document check. A summary line gives counts, for example "23 can stop a case, 4 locked on, 9 only inform".

The checks are grouped by the paper that they look at, in the order that the system runs:

1. Member and policy (IAS)
2. Claim form
3. Vouchers (invoices and receipts)
4. Medical record
5. Bank and payee
6. What the AI read (information only)

Each check is one card with these parts:

| Part | Content |
|---|---|
| Question | The check as a plain question, for example "Do the vouchers add up to the claimed amount?" |
| Tags | *Can stop the case*, *Warning only* or *Information*, plus *Locked on* |
| What it does | One or two plain sentences |
| If it fails | What happens next. A document check quotes the sentence that the customer receives. A member check says that the case waits for a person |
| Reviewer can | What a person can do on a case: *Mark passed*, *Mark failed*, *Correct (fields)* or *Nothing* |
| Switch (phase B) | On, Off, or *Locked on*. The last change shows the person, the date and the reason |

A filter shows the checks that *can stop a case* only. The page does not say which checks use an AI judgment and which use a fixed rule (owner, 2026-10-26). The tables in 4.3 keep that column for developers. A *Show technical details* option adds the code, the line's name on the case page, and the checks that are off in the code.

The question and the *What it does* text are written once, in one catalog file in the API (see 4.6). The other parts are not typed by hand. *If it fails* uses the checklist's own customer sentence. *Reviewer can* uses the same rules as the correction panel (`modules/ai-feedback/corrections.js`). The page then always matches the system.

### 4.3 The checks today

These are the checks in the code on 2026-10-26.

Member check (`modules/member-verification`):

| Code | Check | Effect | Uses AI | Reviewer can |
|---|---|---|---|---|
| `MEMBER_NOT_FOUND` | Member found in IAS | Stops the case | No | Nothing |
| `COVERAGE_NOT_ACTIVE` | Coverage active on the treatment date | Stops the case | No | Nothing |
| `member:dob` | Date of birth matches IAS | Stops the case | No | Mark passed, correct *Date of birth* |
| `member:bank` | Bank name, account holder and account number match IAS | Stops the case | No | Mark passed, correct the bank fields |
| `member:policy` | Policy number matches IAS | Stops the case | No | Mark passed, correct *Policy number* |
| `POSSIBLE_EXCLUSION` | Diagnosis is not a policy exclusion | Warning for the approver | Yes | Nothing |
| `BENEFIT_NOT_ELIGIBLE` | Benefit type is in the member's plan | Warning | No | Nothing |
| Benefit limits | Plan limits shown for the assessment | Information | No | Nothing |

Document check, fixed rules (`modules/document-checking/checklist.js`, `EVALUATORS`):

| Code | Check | Effect | Reviewer can |
|---|---|---|---|
| `INCOMPLETE_CLAIM_FORM` | Claim form describes the illness and the treatment | Stops the case | Mark passed or failed, correct the medical fields |
| `MISSING_VOUCHER` | A voucher is attached | Stops the case | Mark passed or failed |
| `NO_MEDICAL_REPORT` | A medical record is attached | Stops the case | Mark passed or failed |
| `EYE_TEST_SLIP_UNDATED` | If there is an eye test slip, it has a treatment date | Stops the case | Mark passed or failed |
| `UNCLEAR_VOUCHER` | Each voucher is readable | Stops the case | Mark passed or failed |
| `INCORRECT_VOUCHER` | Each voucher has a clinic stamp or a doctor signature | Stops the case | Mark passed or failed |
| `MISSING_VOUCHER_BREAKDOWN` | A pharmacy voucher shows a line-by-line breakdown | Stops the case | Mark passed or failed |
| `VOUCHER_AMOUNT_MISMATCH` | The vouchers add up to the claimed amount | Stops the case | Mark passed or failed, correct the voucher amounts and the claimed amount |
| `INCOMPLETE_MEDICAL_REPORT` | The medical record is readable | Stops the case | Mark passed or failed |
| `MISSING_BANK_INFO` | Bank details are given | Stops the case | Mark passed or failed, correct the bank fields |
| `MISSING_MANDATORY_FIELD` | 20 required claim form fields are read (case number, policy, claimant, claim and bank fields, customer signature) | Stops the case | Correct the value (10 of the fields) |
| `TREATMENT_DATE_INCONSISTENT` | The claim date matches the medical record date | Stops the case | Mark passed, correct the dates |
| `INVOICE_DATE_INCONSISTENT` | Each voucher date matches the medical record date | Stops the case | Mark passed, correct the voucher dates |

Document check, AI comparisons (`modules/document-checking/service.js`, `runJudgments`):

| Code | Check | Effect | Reviewer can |
|---|---|---|---|
| `DELEGATION_LETTER_REQUIRED` | The bank account holder is the claimant, or a delegation letter is attached (not on a claim for a child) | Stops the case | Mark passed or failed |
| `DELEGATION_PAYEE_INCONSISTENT` | The delegation letter payee matches the account holder | Stops the case | Mark passed |
| `PATIENT_NAME_INCONSISTENT` | The claimant name matches the medical record | Stops the case | Mark passed |
| `HOSPITAL_NAME_INCONSISTENT` | The hospital name matches the medical record | Stops the case | Mark passed |
| `INVOICE_NAME_INCONSISTENT` | The claimant name matches each voucher (not on a claim for a child) | Stops the case | Mark passed |
| `PROVIDER_NAME_INCONSISTENT` | The doctor name matches the medical record | Off in the code (false mismatches) | Mark passed |
| `DIAGNOSIS_TREATMENT_INCONSISTENT` | The medical record supports the diagnosis | Off in the code (false mismatches) | Mark passed |

Document check, information lines (never stop a case):

| Code | Check | Uses AI | Reviewer can |
|---|---|---|---|
| `VITAMIN_OR_SUPPLEMENT` | No vitamins or supplements on the vouchers. If `vitaminsBlockStp` is on, a vitamin blocks STP | Yes | Nothing |
| `DOCUMENT_LIST` | Documents found, with the kind and date of each page | Yes | Nothing |
| `BENEFIT_TYPE` | The benefit type that the documents show | Yes | Nothing |
| `DOCUMENT_DATES` | The medical documents are dated | Yes | Nothing |
| `VALUE_FORMAT` | The values read look valid (NRC, dates, amounts) | No | Nothing |
| `FIELDS_READ` | The key values were read clearly (AI confidence) | Yes | Nothing |

### 4.4 Switching a check off

1. The super admin turns a switch off. The console asks for a reason, which is required.
2. The API stores the change: the check code, on or off, who, when, and the reason.
3. From the next check run, the switched-off check does not run. If it is an AI comparison, the AI call is not made.
4. On the case, the checklist line shows *Turned off* with the date and the reason, not a pass and not a fail. The line adds no issue, so the customer is not asked about it.
5. The assessment summary (case page, team emails and IAS remark) shows the line as *Turned off*.
6. A case that was already checked keeps its result. The switch applies to the next check of a case: a new case, a re-check after an upload, or a correction.
7. Switching a check on again works the same way, with a reason.

### 4.5 Checks that cannot be switched off

Some checks protect the payment or the IAS revision itself. The page shows them as *Locked on*, and the API refuses to switch them off. The proposed list:

1. `MEMBER_NOT_FOUND`: the IAS revision cannot run without the member.
2. `COVERAGE_NOT_ACTIVE`: paying outside the coverage period is a payment risk.
3. `member:bank`: a wrong account means a wrong payment.
4. `MISSING_VOUCHER`: no claim amount can be proved without a voucher.
5. `member:balance`: paying beyond the member's remaining balance is a payment risk (added 2026-10-26, with the member balance check).

The owner approved this list on 2026-10-26 (Q1).

### 4.6 One source for the list

A new catalog file in the API (`modules/ai-checklist/catalog.js`) holds one entry per check: code, group, label, *What it does*, effect, uses AI, and locked. The labels are read from the existing maps (`ISSUES`, `JUDGMENT_CHECKLIST_LABELS`, `MEMBER_ITEM_LABELS`) so that they are not typed twice. A test makes sure that every code that the checks can produce has a catalog entry. A new check then cannot be added without its row on this page.

## 5. New settings and data

1. One append-only table `ulink_check_switches` (migration `20261026120000-create-check-switches`, run on dev): `code`, `enabled`, `reason`, `changed_by`, `created_at`. Each change adds a row. The latest row for a code is its state, and a check with no row is on. The rows are also the full history (Q4), so no second table is needed.
2. `GET /api/ai-checklist`: the catalog, each check's switch, and the *Reviewer can* column. Super admin.
3. `PUT /api/ai-checklist/:code` with `{ enabled, reason }`. Super admin. The API refuses a locked check and an empty reason.

## 6. Open questions

| No. | Question | Proposed default |
|---|---|---|
| Q1 | Which checks are locked on? | Decided 2026-10-26: the five in 4.5 |
| Q2 | Can a case go STP while a check that can stop a case is switched off? | Decided 2026-10-26: no. Any check that can stop a case and is switched off sends the case to a person (JD3) |
| Q3 | Do switches apply to the email flow and the API flow together, or to each one separately? | Decided 2026-10-26: together, one switch for each check |
| Q4 | Must the page show the full history of changes, or only the last change? | Decided 2026-10-26: last change on the page, full history in the table |
| Q5 | Can reviewers and operations staff see the page read-only? | No, super admin only at first |
| Q6 | Can the two AI comparisons that are off in the code (doctor name, diagnosis) be switched on from this page? | No. They stay off in the code until an accuracy pass on real samples |
| Q7 | Do the information lines get a switch, or are they always shown? | Shown always, no switch, because they never stop a case |

## 7. Implementation plan

The owner approves one phase at a time. Each phase ends with the `ulink-api` tests passing, `ulink-console` building, a code review, and a suggested commit message and file list.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. Read-only list | Catalog file, coverage test, `GET /api/ai-checklist`, console page with the columns in 4.2 (no switches) | Owner approves this PRD | Done, awaiting review (2026-10-26) |
| B. Switches | Tables, migration and `PUT` endpoint. The member check and the document check skip switched-off checks. *Turned off* on the checklist and the assessment summary. Console switches with a reason | A done, Q1 to Q4 | Done, awaiting review (2026-10-26) |
| C. Docs | `OPERATIONS.md` and the API flowchart updated, a short user guide for the page | B done | Not started |

Phase A alone already answers the first goal: the owner and ULINK can see what the system checks today.
