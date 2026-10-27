# SYSTEM_5 PRD: clear review actions with a reason on the console

Owner: Steven Yeo. Written: 2026-10-27. Status: approved by the owner on 2026-10-27 (Q1 to Q3: the proposed defaults).
Source: 4th demo feedback. "The Mark OK and revise links are very small." The users want a better way than a click on Mark OK. They also want to give a reason for Mark OK and for a revision or an override.

## 1. Background

A reviewer (human in the loop) handles a case that the system holds on the review page (`/cases/:id/review`). Today the reviewer can do these things:

| Action | Where | What it does |
|---|---|---|
| Mark OK / Mark wrong | Each open finding (`FindingsPanel.tsx`) | Sets one check to passed or failed |
| Edit | Each finding, and each value that a failed rule compared | Corrects one value that the AI read |
| Mark OK, Bypass, Does not apply, Let it go on | Member findings | Sets aside one member finding |
| Right | Each finding with an unsure value | Says that the AI read the value right |
| Override | The case page (`CaseOverridePanel.tsx`) | Skips the whole member check or document check |

A reason is already required. The API refuses a correction with a reason shorter than 3 characters (`ai-feedback/corrections.js`). The override needs a reason that is not empty (`casesController.js`).

The demo users had four problems:

1. Each finding shows what failed, but not what the check is for, what the reviewer can do, or what happens if the reviewer marks it OK. The reviewer must know the rules by heart.
2. The actions are 12px text links with no button shape (`text-xs hover:underline`). Users miss them.
3. The reviewer sees the reason box only after a click. The form also asks "What went wrong?" with five technical answers (reading, mapping, check, IAS out of date, exception).
4. After a change, the finding shows no clear state. Only the save button at the bottom shows that changes wait.

## 2. Goals and non-goals

Goals:

1. Each finding says, in plain words, what it checks, what the reviewer can do, and the risk of marking it OK.
2. Each review action is a clear button, which the reviewer finds on the first look.
3. Each action asks for the reason in the same way, in one card, before the action counts.
4. The reviewer sees which findings have a decision, the reason for each, and what is not saved yet.
5. The reason that the reviewer writes is useful for the audit and for the AI learning (`ulink_ai_feedback`).

Non-goals:

1. New review actions or new case statuses. The pipeline does not change.
2. Changes to who can act (super admin only, as today).
3. The claim preparation choices (`PreparationReviewPanel.tsx`) and the benefit choice (`BenefitReviewPanel.tsx`). They use other forms. A later phase can give them the same style.

## 3. Users

| User | Use |
|---|---|
| Reviewer (CSR / Ops, super admin role) | Decides each finding with a reason, then saves all decisions at once |
| Approver (JD3) and auditors | Read who decided what and why, on the case timeline and in the team emails |
| ULINK AI owner | Uses the reasons and the answers to "what went wrong" to improve the AI |

## 4. Requirements

### 4.0 Each finding explains itself

1. Each open finding shows a short *What to do* line under its text. A click on the line opens three parts:
   - *What it checks*: the check's `does` text from the AI checklist catalog (`ai-checklist/catalog.js`).
   - *What you can do*: the check's `reviewerCan` text from the catalog.
   - *Risk if you mark it OK*: a new `riskIfOk` text in the catalog, one or two sentences for each check that can stop a case or warn. Example for the hospital name: "The claim may be for a visit at another hospital than the documents show. IAS gets the medical record hospital."
2. The decision card (4.2) also shows *Risk if you mark it OK* above the reason box, for Mark OK, Bypass and Let it go on.
3. The console reads the texts from `GET /api/ai-checklist`, which the AI checklist page already uses. The same text shows on both pages.
4. The owner reviews every `riskIfOk` text before phase B ships.

### 4.1 Action buttons

1. Each open finding shows its actions as buttons in one row under the finding text. The buttons use the existing `Button` component with a new small size (`size="sm"`: about 32px high, 13px text, an icon).
2. The button labels and styles:

   | Button | Icon | Style | Shown when |
   |---|---|---|---|
   | Mark OK | check | Green outline | A failed check that a person can pass |
   | Mark wrong | x | Red outline | A passed check that a person can fail |
   | Edit value | pencil | Orange outline | A value the AI read, or a value that a failed rule compared |
   | The AI read it right | check-check | Teal outline | A value the AI was unsure of |
   | View page | file | Plain | The finding names a page of a document |

3. A member finding uses the same row, with its own labels: *Mark OK* (date of birth, policy number), *Bypass* (balance, exclusion in IAS), *Does not apply* and *Let it go on (no STP)* (policy contract exclusion).
4. Each button has an `aria-label` that names the finding, for example "Mark OK: Hospital name".

### 4.2 Decision card

1. A click on Mark OK, Mark wrong, Edit value, Bypass, Does not apply or Let it go on opens a decision card under the finding. Only one card is open at a time. A second click on another finding closes the first card and keeps its draft.
2. The card title names the action and the finding, for example "Mark OK: Hospital name".
3. The card shows, in this order:
   1. For Edit value only: the AI's value and the box for the correct value.
   2. Quick reasons: three or four buttons that fit the action (4.3).
   3. The reason box. It is required. A quick reason fills it, and the reviewer can add to it.
   4. The buttons *Add decision* and *Cancel*.
4. *Add decision* stays off until the reason is long enough (4.5) and, for Edit value, until the value changed. A short line under the button says what is missing, for example "Write at least 10 characters".
5. The "What went wrong?" list goes away. The quick reason sets the answer behind it (`wrongStep`). If the reviewer writes a reason with no quick reason, the default answer of today applies. For a value, it is a misread. For a verdict, the check was wrong. For the balance and an exclusion, it is an exception.

### 4.3 Quick reasons

Each quick reason fills the reason box with its text and sets `wrongStep`.

| Action | Quick reason (text put in the reason box) | `wrongStep` |
|---|---|---|
| Edit value | The page shows another value. The AI misread it. | `reading` |
| Edit value | The AI read the right value but put it in the wrong field. | `mapping` |
| Mark OK / Mark wrong | The document shows that the check is wrong. | `check` |
| Mark OK | IAS has an old record. The claim document is right. | `ias_outdated` |
| Mark OK | The AI was right, but we accept it as an exception. | `exception` |
| Bypass | Accepted as an exception after review. | `exception` |
| Does not apply | The clause does not cover this claim. | `check` |
| Let it go on | The clause applies, but the case goes on for approval. | `exception` |

### 4.4 State of each finding

1. A finding with a decision that is not saved shows a badge, for example "Marked OK, not saved". The badge has the buttons *Change* (opens the card again) and *Undo* (drops the decision).
2. The reason shows under the badge in one line.
3. After the save, the finding moves out of the open list as today. The case timeline shows the decision with the person, the time and the reason, as today.

### 4.5 Reason rules

1. A reason must have at least 10 characters after spaces at the start and end are removed. Today the limit is 3.
2. The API checks the same rule. It refuses a shorter reason for a correction (`ai-feedback/corrections.js`), for a Mark OK on an unsure value (`correctionsController.js` confirmations, owner 2026-10-27) and for an override (`casesController.js`). The error text says "Write a reason of at least 10 characters."
3. A quick reason alone is long enough.

### 4.6 Save bar

1. While one or more decisions wait, a bar stays at the bottom of the review page (sticky). It shows "3 decisions ready" and the buttons *Review and save* and *Discard all*.
2. *Review and save* opens a dialog. The dialog lists each decision as "Action: finding. Reason." It has the buttons *Save all and check again* and *Back*.
3. When a card is open with a draft that is not complete, the bar says "1 decision not complete", and *Review and save* stays off.
4. Where today the claim preparation saves the corrections (one save for both), the bar keeps that rule. It shows *Go to save* as today.

### 4.7 Override panel

1. The override panel (`CaseOverridePanel.tsx`) uses the same card: a title such as "Skip the member check", quick reasons, then the reason box, with the rule in 4.5.
2. Quick reasons for an override: "The documents are complete. The AI was wrong.", "IAS was fixed. The member details now match.", "Accepted as an exception after review."
3. The confirm dialog of today stays. It also shows the reason.

## 5. API and data

1. No new table, migration or `.env` value.
2. The minimum reason length changes from 3 to 10 characters in `ai-feedback/corrections.js` (`validateCorrection`) and in the override (`casesController.js`). One constant holds the number.
3. The API takes the same body as today (`kind`, `item`, `passed` or `value`, `reason`, `wrongStep`).

## 6. Risks

1. A minimum of 10 characters can lead to filler text. Quick reasons give a good default, and the reviewer can add details.
2. Older corrections with reasons shorter than 10 characters stay as they are. The rule applies only to new decisions.

## 7. Open questions

| No. | Question | For | Proposed default |
|---|---|---|---|
| Q1 | Is 10 characters the right minimum for a reason? | Owner | Decided 2026-10-27: 10 |
| Q2 | Is a quick reason alone enough, or must the reviewer always add their own words? | Owner | Decided 2026-10-27: a quick reason alone is enough |
| Q3 | Do the claim preparation and benefit panels get the same style now, or in a later phase? | Owner | Decided 2026-10-27: later phase |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with these steps: the `ulink-api` tests pass, `ulink-console` builds, a code review runs, and a commit message and file list are suggested.

| Phase | Content | Status |
|---|---|---|
| A. API | Minimum reason of 10 characters for corrections and overrides, one constant. `riskIfOk` text for each check in the catalog, for the owner's review. Tests | Done, awaiting review (2026-10-27). The confirm API also needs the reason |
| B. Console: findings | *What to do* line, `Button` small size, action rows, decision card with quick reasons, finding badges, save bar and dialog (`FindingsPanel.tsx`, `InlineCorrection.tsx`, `correctionDraft.ts`) | Done, awaiting review (2026-10-27). The no-reason *Right* link on passed lines is removed |
| C. Console: override | The override panel uses the same card and quick reasons | Not started. The 10-character rule and its hint are already in (phase B review fix) |
| D. Docs | `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the change log | Not started |
