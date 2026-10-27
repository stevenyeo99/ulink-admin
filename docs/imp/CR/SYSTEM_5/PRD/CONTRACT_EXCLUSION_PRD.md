# SYSTEM_5 PRD: policy contract exclusion stops the case for review

Owner: Steven Yeo. Written: 2026-10-27. Status: draft, for the owner's review. Owner decisions recorded 2026-10-27.
Source: `Internal_Note_Feedback.md`, the note on checks before a document request, point 3. Related: `MEMBER_EXCLUSION_PRD.md`.

## 1. Background

ULINK asked that, before the system asks a customer for more documents, it makes sure that the claimed items are not under an exclusion. The member check has two exclusion checks:

1. *Member and policy exclusion in IAS* (`member:exclusion`). It stops the case at member review (`MEMBER_EXCLUSION_PRD.md`).
2. *Policy contract exclusion* (`POSSIBLE_EXCLUSION`). The system finds the 5 contract clauses nearest to the diagnosis and treatment text (table `ulink_policy_exclusion_clauses`). Then the AI judges whether one applies. Today a match is only a warning for the approver (JD3). The case goes on, and the customer can be asked for documents.

The owner decided on 2026-10-27 that a contract exclusion match also stops the case, so that a person reviews it first.

## 2. Goals and non-goals

Goals:

1. A contract exclusion match stops the case at member review, before the document check. The customer is not emailed.
2. The person sees the clause, its words, the AI's confidence and the AI's reason.
3. The person either marks the match as not applying, or lets the case go on as an exception.
4. The same backend logic runs in the email flow and the API flow.

Non-goals:

1. Rejecting a claim. A person decides (SOP §6.3).
2. Changing the clause search, the clause table or the judge prompt.
3. Changing the IAS exclusion check (`member:exclusion`).

## 3. Users

| User | Use |
|---|---|
| Reviewers (CSR / Ops) | See the match with the clause, the confidence and the reason. Mark it OK or let it go on, with a reason |
| Approver (JD3) | Sees the match and the person's decision in the assessment summary. Approves a claim that a person let go on |
| Customer | Is not asked for documents on a claim that a person has not cleared for a contract exclusion |

## 4. Requirements

### 4.1 Where it runs

The check stays where it is: in the member check (`member-verification/service.js` `checkCase`), after the member passes the other member checks, in both flows. It uses the claim form's diagnosis and treatment text, not the ICD-10 code.

### 4.2 The outcome

| Situation | Email flow status | API flow status | What happens |
|---|---|---|---|
| The AI finds a clause that applies (confidence 0.5 or more, as today) | `MEMBER_REVIEW_REQUIRED` | `API_MEMBER_REVIEW_REQUIRED` | A member finding `POSSIBLE_EXCLUSION`. The case waits for a person, and the team is emailed. The customer is not emailed |
| No clause applies | as today | as today | The case goes on |

A clause with severity `cap` (it limits an amount, not the whole claim) also stops the case. The finding says that the clause limits the amount.

The finding shows the clause, its words, the confidence and the reason:

```
Policy contract exclusion: clause 6.22 "Cosmetic surgery ... weight loss" (confidence 0.82). Treatment is Tirzepatide with BMI 30.2.
```

The policyholder override notes stay on the finding, as today.

### 4.3 The finding on the member review panel

1. The finding is listed on the member review panel of the case page and the review workspace, like the other member findings.
2. The person chooses one of two answers, with a required reason:
   1. *Does not apply*. The AI was wrong. It is recorded as an AI mistake (`wrongStep: check`) and counts for AI feedback. The claim can still go STP.
   2. *Applies, let it go on*. The case goes on as an exception (`wrongStep: exception`). The claim never goes STP. JD3 approves it in IAS.
3. The answer covers the clause that the person saw and the diagnosis and treatment text it was judged on. A new clause match, or a corrected diagnosis or treatment that matches again, raises the finding again.
4. A whole-check *Override and continue* at member review works as today. The claim then never goes STP. This includes a member check overridden for another finding before the contract check ever ran, because the contract was then not checked.

### 4.4 Reusing the AI answer

A case at member review is checked again on every run. The AI answer is saved with the case and reused while the diagnosis and treatment text are unchanged, the same as the IAS exclusion check. The case then does not call the AI on every run, and a person's answer stays in force.

### 4.5 STP

| Case | STP |
|---|---|
| No contract exclusion match | As today |
| *Does not apply* | As today. The match no longer counts as an open review point |
| *Applies, let it go on*, or a whole-check override | Never STP. The STP reason says that a contract exclusion was let through by a person |
| The check is switched off on the AI checklist page | Never STP (the AI checklist rule for a check that can stop a case) |

### 4.6 What people see

1. The assessment summary line *Policy contract exclusion* stays. It adds the confidence and, after a decision, the person's answer, who and why.
2. On the AI checklist page, the card *Could the diagnosis be excluded by the policy contract?* changes from *Warning only* to *Can stop the case*. It stays switchable. A reviewer can *Mark passed* or let it go on.
3. The team email for member review (*Member verification hold*) lists the finding with the clause, the confidence and the reason.

## 5. New settings and data

No new table, migration or `.env` value. The member check result (`memberVerifyResult`) keeps the AI answer with the text that it was judged on, for reuse (4.4).

## 6. Risks

1. The clause search finds clauses by similar meaning, so the AI can match a clause that does not apply. Each false match holds a case for a person. Dev has no member-checked cases yet, so the rate is unknown. Measure it on UAT after release.
2. If the check holds too many cases, a super admin switches it off on the AI checklist page. Then no claim goes STP until it is on again.

## 7. Open questions

| No. | Question | For | Answer or proposed default |
|---|---|---|---|
| Q1 | Does a contract exclusion match stop the case at member review? | Owner | Decided 2026-10-27: yes, a person reviews it first |
| Q2 | After *Does not apply*, can the claim still go STP? | Owner | Decided 2026-10-27: yes |
| Q3 | Are the confidence and the reason shown to the reviewer? | Owner | Decided 2026-10-27: yes |
| Q4 | Does a `cap` clause (a limit, not an exclusion) also stop the case? | Owner | Decided 2026-10-27: yes, and the finding says that the clause limits the amount |
| Q5 | Does a match below the AI confidence threshold (default 70%) stop the case, or only a match at or above it? | Owner | Decided 2026-10-27: every match from 0.5, as today. The confidence is shown, so the reviewer can weigh it |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with the `ulink-api` tests passing, `ulink-console` building, a code review, and a suggested commit message and file list.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. Backend | `POSSIBLE_EXCLUSION` becomes a member finding that holds the case (both flows). AI answer saved and reused while the text is unchanged. *Does not apply* and *Applies, let it go on* through the existing correction (`wrongStep` check or exception), covering the clause and the text. STP rule (4.5). The summary line with the confidence and the decision. The AI checklist card | Owner approves this PRD, Q4 and Q5 (both decided 2026-10-27) | Done, awaiting review (2026-10-27). Release together with B |
| B. Console | The member review panel offers the two answers for this finding. The finding shows the clause, the confidence and the reason | A done | Done, awaiting review (2026-10-27) |
| C. Docs | `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the API flowchart and its published page, the AI checklist user guide, the change log | B done | Not started |
