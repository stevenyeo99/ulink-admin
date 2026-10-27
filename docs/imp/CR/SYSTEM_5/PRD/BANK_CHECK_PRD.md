# SYSTEM_5 PRD: bank details differ from IAS is a warning, and a misread account number is flagged

Owner: Steven Yeo. Written: 2026-10-27. Status: draft, for the owner's review. Owner decisions recorded 2026-10-27.
Source: `Internal_Note_Feedback.md`, AI checklist feedback from the 4th demo, point 1.

## 1. Background

Today the member check compares the claim form's bank name, account holder and account number with the member's IAS record. Any difference is the member finding `member:bank` (`BANK_DETAILS_MISMATCH`). It stops the case at member review, and it is locked on in the AI checklist (decision of 2026-10-26: "a wrong account means a wrong payment").

The IAS claim never uses the claim form's bank details. The claim payload takes `BankName`, `BankAcctNo` and `BankAcctName` from the member's IAS record (`ias-claim-preparation/payloadBuilder.js`). A difference therefore does not change where the money goes. It only means that the customer wrote other details, for example a new account.

Nothing checks whether the account number that the AI read looks like an account number. The value format check (`formatCheck`) covers the NRC or passport, the dates and the amounts only.

At the 4th demo, the users asked that a difference from IAS be a warning only. They also asked that a misread account number be flagged, so that a person can correct it.

## 2. Goals and non-goals

Goals:

1. A difference between the claim form's bank details and IAS is a warning. The case goes on to the next step. When every other STP rule is met, the claim can go STP.
2. An account number that does not look like an account number is an *AI unsure* point that a person can correct.
3. The same backend logic runs in the email flow and the API flow.

Non-goals:

1. Changing the bank details that the IAS claim uses. They stay the IAS record's.
2. A format rule for each bank. That waits until ULINK gives the account number lengths.
3. A format check for the bank name or the account holder.
4. Changing the check for missing bank details (`MISSING_BANK_INFO`) or the delegation letter checks.

## 3. Users

| User | Use |
|---|---|
| Reviewers (CSR / Ops) | No longer mark OK a case only because the customer wrote other bank details. Correct a misread account number |
| Approver (JD3) | Sees the bank warning in the assessment summary of a claim that is not STP for another reason |

## 4. Requirements

### 4.1 Bank details differ from IAS

1. The member check still compares the three values with the same rules. A bank name in short form and a title such as U or Daw do not count as a difference.
2. A difference is no longer a member finding. It does not stop the case, and it is not on the member review panel.
3. It is a warning on the member check, in the same way as *Benefit not eligible*: a line *Bank details differ from IAS* in the assessment summary (case page, team emails, IAS remark), with both values for each field that differs. The line says that the IAS claim pays to the IAS account.
4. The warning does not block STP, because the IAS claim pays to the IAS account (owner, 2026-10-27). It is not a review point.
5. A case already waiting at member review only for a bank difference goes on at the next run, with the warning.

### 4.2 Account number format

1. The value format check (*Values read look valid*, `VALUE_FORMAT`) also checks the account number.
2. The rule for now: after spaces and dashes are removed, the account number is digits only. It can change once ULINK gives the lengths for each bank.
3. An account number that fails is an *AI unsure* point, the same as a misread NRC today: *✎ Edit* on the review page, never a missing-document request to the customer. Hold switch #3 decides whether the case waits for a person.
4. A missing account number stays with `MISSING_BANK_INFO` and the required field check. This rule checks only a value that was read.

### 4.3 AI checklist page

1. The card *Do the bank details match IAS?* (`member:bank`) changes from *Can stop the case* to *Warning only*. It is no longer locked on, so a super admin can switch it off. A switched-off warning does not block STP (Q2).
2. The card *Values read look valid* names the account number.
3. The locked list (SYSTEM_5 PRD 4.5) becomes four checks: member found, coverage, member balance, voucher attached.

## 5. New settings and data

No new table, migration or `.env` value.

## 6. Risks

1. A real wrong account on the form is no longer a stop, and the claim can go STP. The IAS claim still pays to the IAS account, so the money does not go to the account on the form. A customer who expects payment to a new account must update it in IAS.
2. The digits-only rule can pass a number of the wrong length. That waits for the lengths from ULINK.

## 7. Open questions

| No. | Question | For | Answer or proposed default |
|---|---|---|---|
| Q1 | Can a claim with bank details that differ from IAS go STP? | Owner | Decided 2026-10-27: yes. The warning does not block STP. The other STP rules still apply |
| Q2 | Does switching off the bank warning on the AI checklist page block STP? | Owner | Decided 2026-10-27: no. A switched-off warning does not block STP (`offStopping` counts only checks that can stop a case) |
| Q3 | What is a valid account number? | Owner, ULINK | Decided 2026-10-27: digits only for now. Lengths for each bank later, from ULINK |
| Q4 | Are the bank name and the account holder checked for format? | Owner | Decided 2026-10-27: no, only the account number |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with these steps: the `ulink-api` tests pass, `ulink-console` builds, a code review runs, and a commit message and file list are suggested.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. Backend | `member:bank` becomes a warning flag (not a member finding), with both values. It does not block STP. Account number digits-only rule in `formatCheck`. AI checklist cards (the bank card is *Warning only* and not locked, and the format card names the account number). Tests | Owner approves this PRD (Q1 to Q4 decided 2026-10-27) | Done, awaiting review (2026-10-27). The warning also shows in the case journey |
| B. Docs | `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the API flowchart and its published page, the SYSTEM_5 PRD locked list, the AI checklist user guide, the change log | A done | Done, awaiting review (2026-10-27) |
