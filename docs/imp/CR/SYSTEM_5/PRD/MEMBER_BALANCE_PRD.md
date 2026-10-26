# SYSTEM_5 PRD: member balance check in the member check

Owner: Steven Yeo. Written: 2026-10-26. Status: draft, for the owner's review.
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

All four limit types count. The voucher's *available balance* is the lowest balance among those limits. The rules:

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

These rules depend on the meaning of the IAS fields (7, Q1 to Q3). They are built only after IAS answers.

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

The balance finding works like the other member findings (date of birth, bank details, policy number):

1. It is listed on the member review panel of the case page and the review workspace, with its text.
2. A person can *Mark OK* with a reason, for example "Partial payment agreed, IAS pays up to the balance". The case then goes on to the document check. The voucher amount sent to IAS does not change.
3. A mark OK covers only the finding that the person saw. If the balance or the voucher amount changes, the finding text changes, and the finding is raised again. This is the existing rule for member findings (`covers` in `member-verification/checks.js`).
4. The person can also fix the cause instead: correct a misread voucher amount, or choose another head on the *Choose the benefit* screen. The member check then runs again.
5. A case at member review is checked again on every run. If another claim is reversed and the balance becomes enough, the finding clears and the case moves on by itself.
6. `member:balance` joins the member findings that a person can mark OK (`ACCEPTABLE_MEMBER_ITEMS` in `checks.js`).

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

1. Claim preparation reuses the heads saved by the member check, whether the AI's or a person's, for each voucher whose key is unchanged.
2. If a voucher changed after the member check, preparation picks its head again as today. If that pick is not sure, preparation review asks for it as today.
3. Preparation review keeps the diagnosis code and the vitamin rejection. In the normal case it no longer asks for the head.

### 4.9 What people see

1. The case page and the review workspace show the balance lines of 4.4, one per voucher, with the benefit type and head codes and descriptions.
2. The assessment summary (case page, team emails, IAS remark) has one balance line.
3. The AI checklist page gets one new member check entry: *Is there enough balance for each voucher?* (`member:balance`, can stop the case, reviewer can mark passed). The catalog test forces the entry.
4. The existing *Plan limits* information line (`benefitLimits`, the plan's filed limits) is replaced by the balance line.

## 5. New statuses, settings and data

1. New statuses `BENEFIT_REVIEW` and `API_BENEFIT_REVIEW`, with a migration for the status rule on `ulink_cases`. They go in the review queue with the reason *Choose the benefit*.
2. New configuration value `GET_MEMBER_LIMIT_BALANCE_API`.
3. The `holdUnsureBenefit` switch now applies at the member check, in both flows. Today it applies to API cases at claim preparation only.
4. The member check result (`memberVerifyResult`) holds the heads picked, the balance answer used, and the result per voucher. No new table is added.

## 6. Risks

1. A wrong reading of the IAS fields stops good claims. Example: 0 means "no limit at this level", but the system reads it as "used up". Then every claim of that type stops. The rules in 4.4 wait for the IAS answers.
2. More cases stop for a person. Unsure heads now stop the case before the document check, in both flows. The `holdUnsureBenefit` switch controls this.
3. The balance can change between the member check and the IAS revision. The member check result is a snapshot. IAS assesses against the real balance at revision time.

## 7. Open questions

| No. | Question | For | Proposed default |
|---|---|---|---|
| Q1 | Is `amt_yr` the remaining balance for the year, or the yearly limit? | IAS | Remaining balance (the sample has values such as 9,434,070) |
| Q2 | Does `0` mean "used up" or "no limit at this level"? The sample shows Outpatient at 0 while its heads show 660,000 | IAS | No default: needed before build |
| Q3 | Does `null` mean "no limit"? Do `amt_life`, `vis_yr` and `amt_vis` also need checking? | IAS | `null` = no limit. First version checks `amt_yr` and `amt_life` only |
| Q4 | If there are several plans, which entry of `results[]` applies? | IAS | The plan with the same `plan_id` as `memberPlans[0].PLAN_ID` |
| Q5 | Does the balance include claims still being processed, or only paid claims? | IAS | Paid only. If a pending claim explains the finding, a person can mark it OK |
| Q6 | Which roles can choose the head and correct the amount on the new screen? | Owner | The reviewer roles that can use preparation review today |
| Q7 | Does a balance finding ever email the customer? | Owner | No. The team decides and contacts the customer |
| Q8 | Is `holdUnsureBenefit` on for the email flow too? | Owner | Yes, the same switch for both flows |
| Q9 | Does a possible exclusion (point 3) also stop the case before the document check? | Owner | Separate decision, not in this PRD |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with the `ulink-api` tests passing, `ulink-console` building, a code review, and a suggested commit message and file list.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. IAS client and rules | `getMemberLimitBalance` client and configuration value. The balance rules of 4.4 as a pure function, with tests on the spec sample | Q1 to Q5 answered | Not started |
| B. Member check | Head pick and balance inside `checkCase` (both flows). Saved picks reused. The `member:balance` finding with mark OK. New statuses and migration. AI checklist entries | A done | Not started |
| C. Review screen | *Choose the benefit* screen, `POST /api/cases/:id/benefit`, amount correction with a reason, `recheckFrom` change, review queue reason | B done, Q6 | Not started |
| D. Claim preparation and display | Preparation reuses the saved heads. Balance line on the case page, the review workspace and the assessment summary. `OPERATIONS.md` and the flowcharts | C done | Not started |
