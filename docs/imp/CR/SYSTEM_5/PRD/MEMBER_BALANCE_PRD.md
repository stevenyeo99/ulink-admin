# SYSTEM_5 PRD: member balance check in the member check

Owner: Steven Yeo. Written: 2026-10-26. Status: draft, for the owner's review. IAS and owner questions answered 2026-10-26 (bypass scope A1, second check B1).
Source: `Internal_Note_Feedback.md`, the note on checks before a document request, point 2. IAS interface: `../INTEGRATION/IAS_MEMBER_BALANCE_SPEC.md`.

## 1. Background

ULINK asked that, before the system asks a customer for more documents, it makes sure of three things:

1. The member is still within the coverage period.
2. There is still balance to pay.
3. The claimed items are not under an exclusion.

Point 1 exists today (`COVERAGE_NOT_ACTIVE` in the member check). This PRD covers point 2. Point 3 is a separate decision (see 7, Q9).

Today the system does not know the member's remaining balance. The benefit head of each voucher (for example *Outpatient, Prescribed Medicine*) is picked only in claim preparation, which runs after the document check. So a customer can be asked for documents on a claim that cannot be paid.

IAS now offers `POST /api/get_member_limit_balance`. It returns the member's limits per benefit head, benefit type, combined head and combined type.

## 2. Goals and non-goals

Goals:

1. Before the document check, the AI picks the benefit head of each voucher, and the system checks the balance for that head.
2. If the AI is not sure of a head, a person chooses it before the document check. The balance is then checked with the person's choice.
3. A person can correct a misread voucher amount at the same time. The corrected amount is used for the balance check and is sent to IAS as `PresentedAmt`.
4. The same backend logic runs in the email flow and the API flow, inside the member check.
5. Claim preparation reuses the heads chosen here. It does not pick them again unless a voucher changed.

Non-goals:

1. Making the exclusion check stop a case (point 3 above, Q9).
2. Lowering a voucher amount to fit the balance. IAS applies the plan limits itself during its assessment.
3. Tracking the balance across claims inside ULINK. IAS owns the balance.
4. Changing the diagnosis pick or the vitamin review. They stay in preparation review.

## 3. Users

| User | Use |
|---|---|
| Reviewers (CSR / Ops) | If the AI is not sure, choose the benefit head. Correct a misread voucher amount. See the balance |
| Approver (JD3) | Sees the balance and the heads in the assessment summary |
| Customer | Is not asked for documents on a claim whose balance is not enough, until a person decides |

## 4. Requirements

### 4.1 Where it runs

The balance check runs inside the member check, in `member-verification/service.js` `checkCase`. Both flows already call that function: the email job (`member-verification`) and the API job (`api-member-verification`). No new pipeline job is added.

The member check then does these steps in order:

1. Look up the member in IAS (`get_member_info`), as today.
2. Compare the claim with the IAS record, as today: member found, date of birth, policy number, bank details, coverage period.
3. New: pick the benefit head of each voucher.
4. New: call `get_member_limit_balance` and check the balance for each voucher.
5. Decide the outcome (4.5).

If step 2 already finds a problem, steps 3 and 4 still run, so that the person who reviews the case sees the balance too. The outcome of step 2 comes first (4.5).

### 4.2 The balance request

The three request fields come from the IAS member information answer of step 1. No new data is needed from the customer.

| Request field | Source |
|---|---|
| `memberRefNo` | `payload.member.MBR_REF_NO` (the same value sent to IAS as `MemberRefNo` today) |
| `policyRefNo` | `payload.policies[0].POCY_REF_NO` |
| `policyEffDate` | `payload.policies[0].EFF_DATE` (IAS date format `MMDDYYYY`, for example `09012025`) |

The call follows the same rules as `getMemberInfo` in `member-verification/iasClient.js`: a time-out, and a thrown error on a network failure or a non-2xx answer. A thrown error makes the member check step fail, and the job runs it again on the next run. A new configuration value `GET_MEMBER_LIMIT_BALANCE_API` holds the endpoint path, next to `GET_MEMBER_INFO_API`.

If the balance call fails, the member check decides nothing on a missing balance. The case stays at its current status until a later run gets an answer (owner, 2026-10-26). During a long IAS outage, new cases wait at the member check. The Overview's pipeline health line shows the failing runs.

### 4.3 Picking the benefit head

1. The system calls the existing `pickBenefit` (`ias-claim-preparation/benefitPicker.js`) once for each voucher. The inputs are the voucher type (read at recognition) and the member's plans (from step 1). They are the same inputs that claim preparation uses today.
2. If `pickBenefit` returns a pick, the pick is *sure*. If it has no candidate or its confidence is too low, it returns null.
3. If the case has no voucher yet, no head is picked. Only the benefit type balance is checked (4.4, rule 5). The document check then asks for the voucher. When the customer uploads it, the case is checked again from the member check.
4. The picks are saved with a key of each voucher (`voucherKey`, as preparation review uses). A member check that runs again reuses a saved pick while the voucher is unchanged, so the AI is not called again. This matters because cases at `MEMBER_REVIEW_REQUIRED` are checked again on every run.

### 4.4 Checking the balance

The balance is checked only after every voucher has a head, from the AI or from a person (4.5). For each voucher, the system finds every limit in the balance answer that covers its head:

1. the *Benefit Head* limit (`limit_type_code` `H`) for the head
2. the *Benefit Type* limit (`T`) for its benefit type
3. every *Combine Head* limit (`CH`) that lists the head
4. every *Combine Type* limit (`CT`) that lists its benefit type

All four limit types count. The balance entry used is the one in `results[]` whose `plan_id` and `rev_no` match the member's plan (`memberPlans[0].plan.PLAN_ID` and `.REV_NO`).

Each limit has several amount fields. They are treated as follows (owner, 2026-10-26):

| Field | Meaning | Use |
|---|---|---|
| `amt_yr`, `amt_dis_yr`, `amt_life`, `amt_dis_life`, `amt_pocy` | Remaining balance (year, year per disability, lifetime, lifetime per disability, policy period) | Compared. Vouchers that share the limit are added up |
| `amt_vis` | Limit for one visit | Compared with each voucher on its own, not added up |
| `amt_day`, `amt_sur`, `chronic_ongoing_amt`, `chronic_ongoing_amt_renew` | Per day, surgery, chronic conditions | Not compared. Shown on the case only (Q3a) |
| `deduct_amt`, `deduct_amt_vis`, `deduct_amt_day`, `copay_amt_yr` | Amounts that the member pays | Not compared |

A field with the value `null` has no limit and is skipped. A value of 0 means used up. The balance is the remaining balance at the member plan level, after other claims. It does not include the claim being checked, also for an API case that already exists in IAS.

The voucher's *available balance* is the lowest compared amount among those limits. The rules:

1. Vouchers are checked one by one, in the order that the AI read them. Vouchers that share a limit are added up against it: each voucher sees the *balance left* after the vouchers before it.
2. If the balance left is below the voucher amount, the balance is **not enough** for that voucher. This includes a balance of 0.
3. If the balance left is at least the voucher amount, or no limit covers the head, the balance is **enough**.
4. Some vouchers have no head: the case has no voucher yet, or the AI is not sure and the `holdUnsureBenefit` switch is off. For them, only the benefit type limits (`T` and `CT`) are checked, from the claim form's type of patient.

The result is one line per voucher. Each line shows the benefit type and the benefit head, each with its code and description. It also shows the voucher amount, the balance left, the limit that gave the lowest balance, and the result:

```
Voucher 1 (OP Outpatient / RX Prescribed Medicine): voucher 100,000, balance 150,000 (H RX), enough
Voucher 2 (OP Outpatient / RX Prescribed Medicine): voucher 100,000, balance left 50,000 (H RX), not enough
```

Only the lines that are *not enough* go into the `member:balance` finding. All lines are shown on the case (4.9).

The owner gave the meaning of the IAS fields on 2026-10-26 (7, Q1 to Q5).

### 4.5 The outcome

The member check decides in this order. Each stop then gives a person complete information:

1. Member problems first (not found, coverage, date of birth, bank, policy). They do not depend on the head. Without a member, there is no plan to pick a head from.
2. Unsure heads next. The balance is not judged on a guessed head, because a person's choice can change the result.
3. The balance last, after every voucher has a head.

A rare case with all three can visit member review, then *Choose the benefit*, then member review again for the balance.

| Order | Situation | Email flow status | API flow status | What happens |
|---|---|---|---|---|
| 1 | A member problem from step 2 | `MEMBER_REVIEW_REQUIRED` | `API_MEMBER_REVIEW_REQUIRED` | As today. The case waits for a person, and the team is emailed |
| 2 | The AI is not sure of a head, and the `holdUnsureBenefit` switch is on | `BENEFIT_REVIEW` (new) | `API_BENEFIT_REVIEW` (new) | The case waits for a person to choose the head (4.6) |
| 3 | The balance is not enough for any voucher | `MEMBER_REVIEW_REQUIRED` | `API_MEMBER_REVIEW_REQUIRED` | A member finding `member:balance` (reason code `BALANCE_NOT_ENOUGH`). The case waits for a person, and the team is emailed. The customer is not emailed |
| 4 | Otherwise | `READY_FOR_DOCUMENT_CHECKING` | `API_READY_FOR_DOCUMENT_CHECKING` | The case goes on to the document check, as today |

### 4.5a The balance finding on the member review panel

If the balance is not enough, the case holds at member review for a person (owner, 2026-10-26):

1. The finding is listed on the member review panel of the case page and the review workspace, with one line per short voucher (4.4).
2. The only action on this finding is *Bypass*. A reason is required, for example "Partial payment agreed, IAS pays up to the balance". The finding cannot be marked failed, and the panel offers no amount or head change for it.
3. After a bypass, the case goes on to the document check. The voucher amount sent to IAS does not change.
4. A bypass covers the short vouchers that the person saw: each voucher's number, head and amount (owner, 2026-10-26, option A1). If the balance in IAS moves and the same vouchers are still short, the bypass stays. If a voucher's amount or head changes, or another voucher becomes short, the finding is raised again. The finding stores these as `coverKeys`, and `member-verification/checks.js` compares them.
5. A case at member review is checked again on every run. If another claim is reversed and the balance becomes enough, the finding clears and the case moves on by itself.
6. `member:balance` joins the member findings that a person can set aside (`ACCEPTABLE_MEMBER_ITEMS` in `checks.js`). The reviewer roles can bypass it (Q6). The bypass, its reason, the person and the date are kept in the case history and the assessment summary.
7. A claim whose balance was bypassed never goes STP. A person (JD3) always approves it.

### 4.6 The "Choose the benefit" review

A new review screen opens for cases at `BENEFIT_REVIEW` / `API_BENEFIT_REVIEW`. It reuses the head picker of preparation review.

For each voucher, the screen shows the voucher page, the voucher type and the amount. It also shows the AI's pick with its confidence, or "not sure". Last, it shows the heads that the member's plan allows and the balance for the selected head.

The person can:

1. choose the head of each voucher
2. correct a misread voucher amount (4.7)

The screen shows the total of the vouchers next to the claimed amount on the claim form. If the two will no longer match, it warns before saving.

When the person saves, the system records the choice with the person, the date and a reason. It then runs the member check again with the person's heads and amounts. The outcome follows 4.5. A new endpoint `POST /api/cases/:id/benefit` saves the choice, in the same shape as `POST /api/cases/:id/preparation`.

### 4.7 Correcting a voucher amount

1. The person who chooses the head can also correct a voucher amount on this screen. A reason is required.
2. The correction uses the existing correction record (`ulink_ai_feedback`, `applyCorrection` in `ai-feedback/corrections.js`). The new amount is written into the case's extracted fields.
3. The corrected amount is used for the balance check, the document check and the IAS item `PresentedAmt`. Claim preparation builds `PresentedAmt` from the voucher amount.
4. A correction means only that the AI misread the voucher. It is never used to lower an amount to fit the balance. A planned lower payment belongs in a per-voucher rejected amount with a remark, like the vitamin rejection (out of scope here).
5. Today a voucher amount or type correction checks the case again from the document check (`recheckFrom`). It changes to check again from the member check, because the balance now uses those values.
6. Today only a super admin can correct values. This screen opens amount corrections to the reviewer roles that can choose a head (7, Q6).

### 4.8 Claim preparation

1. Claim preparation reuses the heads saved by the member check, whether the AI's or a person's, for each voucher whose key is unchanged. This comes in phase C, together with the *Choose the benefit* screen, so a person is never asked for the same head twice.
2. If a voucher changed after the member check, preparation picks its head again as today. If that pick is not sure, preparation review asks for it as today.
3. Preparation review keeps the diagnosis code and the vitamin rejection. In the normal case it no longer asks for the head.
4. Just before the claim is built, claim preparation asks IAS for the balance again, with the final heads and voucher amounts (owner, 2026-10-26, option B1). A case can wait at the document check for days, and other claims of the member can be paid in that time. This costs one IAS call and no AI call.
5. If a voucher is short and a bypass already covers it, the case goes on. It never goes STP.
6. If a shortage is new, the case goes back to the member check. The member check raises the same `member:balance` finding at member review, where a person bypasses it on the usual screen. This works the same in both flows.
7. The second check needs the heads of rule 1. Without them, claim preparation and the member check can pick different heads for one voucher and send the case back and forth.

### 4.9 What people see

1. The case page and the review workspace show the balance lines of 4.4, one per voucher, with the benefit type and head codes and descriptions.
2. The assessment summary (case page, team emails, IAS remark) has one balance line.
3. The AI checklist page gets one new member check entry: *Is there enough balance for each voucher?* (`member:balance`, can stop the case, reviewer can bypass with a reason). The catalog test forces the entry.
4. The existing *Plan limits* information line (`benefitLimits`, the plan's filed limits) is replaced by the balance line.

## 5. New statuses, settings and data

1. New statuses `BENEFIT_REVIEW` and `API_BENEFIT_REVIEW`, with a migration for the status rule on `ulink_cases`. They go in the review queue with the reason *Choose the benefit*.
2. New configuration value `GET_MEMBER_LIMIT_BALANCE_API`.
3. The `holdUnsureBenefit` switch now applies at the member check, in both flows. Today it applies to API cases at claim preparation only.
4. The member check result (`memberVerifyResult`) holds the heads picked, the balance answer used, and the result per voucher. No new table is added.

## 6. Risks

1. A used-up limit stops every claim that it covers. In the IAS sample, Outpatient (`T OP`) shows `amt_yr` 0, so every Outpatient claim of that member stops at member review. Before go-live, the rules are tested against one real member whose balance ULINK knows.
2. More cases stop for a person. Unsure heads now stop the case before the document check, in both flows. The `holdUnsureBenefit` switch controls this.
3. The balance can change between the member check and the IAS revision. The member check result is a snapshot. IAS assesses against the real balance at revision time.

## 7. Open questions

| No. | Question | For | Answer or proposed default |
|---|---|---|---|
| Q1 | Is `amt_yr` the remaining balance for the year, or the yearly limit? | IAS | Decided 2026-10-26: remaining balance. Every non-null balance field is compared (4.4) |
| Q2 | Does `0` mean "used up" or "no limit at this level"? | IAS | Decided 2026-10-26: used up |
| Q3 | Does `null` mean "no limit"? | IAS | Decided 2026-10-26: yes. If a field has no value, it is skipped |
| Q3a | Do the per-day, surgery and chronic amounts (`amt_day`, `amt_sur`, `chronic_ongoing_amt*`) need comparing, and how? | Owner | Decided 2026-10-26: not compared, shown on the case only. Deductible and co-pay amounts are ignored |
| Q4 | If there are several plans, which entry of `results[]` applies? | IAS | Decided 2026-10-26: the entry with the same `plan_id` and `rev_no` as the member's plan |
| Q5 | Does the balance include the claim being checked? | IAS | Decided 2026-10-26: no. It is the remaining balance per member plan, so each voucher is compared with it |
| Q6 | Which roles can choose the head, correct the amount and bypass the balance finding? | Owner | Decided 2026-10-26: the reviewer roles that use preparation review today, with a reason each time |
| Q7 | Does a balance finding ever email the customer? | Owner | Decided 2026-10-26: no. The team is emailed, and a person decides |
| Q8 | Is `holdUnsureBenefit` on for the email flow too? | Owner | Decided 2026-10-26: yes, one switch for both flows |
| Q9 | Does a possible exclusion (point 3) also stop the case before the document check? | Owner | Decided 2026-10-26: a separate PRD later. It stays a warning for now |
| Q10 | After a balance finding is bypassed, can the claim go STP? | Owner | Decided 2026-10-26: no, a person (JD3) approves it (4.5a, item 7) |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with the `ulink-api` tests passing, `ulink-console` building, a code review, and a suggested commit message and file list.

Each phase can be released alone. No phase leaves a case at a status that no screen handles.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. IAS client and rules | `getMemberLimitBalance` client in `member-verification/iasClient.js` and the `GET_MEMBER_LIMIT_BALANCE_API` configuration value. The balance rules of 4.4 as a pure function in a new `member-verification/balance.js`. It picks the entry by `plan_id` and `rev_no` and finds the limits that cover a head. It applies the field rules: `null` skipped, 0 used up, vouchers added up, `amt_vis` per voucher. It returns one line per voucher. Tests on the spec sample, including its Outpatient 0. No change to any case | Owner approves this PRD | Done, awaiting review (2026-10-26) |
| B. Balance in the member check | In `checkCase` (both flows): the AI head pick per voucher, saved and reused while the voucher is unchanged, then the balance call and the rules of A. The `member:balance` finding (`BALANCE_NOT_ENOUGH`) at the existing member review status, with the team email. *Bypass* with a required reason, open to the reviewer roles for this finding. No STP after a bypass. AI checklist entry. An unsure head does not stop the case yet: that voucher is checked at benefit type level only (4.4, rule 4) | A done | Done, awaiting review (2026-10-26) |
| C. Choose the benefit | New statuses `BENEFIT_REVIEW` / `API_BENEFIT_REVIEW` and their migration. `holdUnsureBenefit` stops an unsure head at the member check, in both flows. The *Choose the benefit* screen and `POST /api/cases/:id/benefit`. Voucher amount correction by the reviewer roles, with a reason. `recheckFrom` sends voucher amount and type corrections back to the member check. Review queue reason *Choose the benefit*. Claim preparation reuses the heads saved by the member check (4.8, rule 1). No migration was needed: the status rule on `ulink_cases` only checks the `API_` prefix | B done | Done, awaiting review (2026-10-26) |
| D. Second balance check and display | The second balance check at claim preparation, with a new shortage sent back to member review (4.8, rules 4 to 7). The balance lines on the case page, the review workspace and the assessment summary. The *Plan limits* line is replaced. `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md` and the API flowchart (and its published page) updated | C done | Not started |
