# SYSTEM_5 PRD: member and policy exclusion check in the member check

Owner: Steven Yeo. Written: 2026-10-26. Status: draft, for the owner's review. Owner decisions recorded 2026-10-26.
Source: `Internal_Note_Feedback.md`, the note on checks before a document request, point 3. IAS interface: `../INTEGRATION/IAS_MEMBER_EXCLUSION_SPEC.md`.

## 1. Background

ULINK asked that, before the system asks a customer for more documents, it makes sure of three things:

1. The member is still within the coverage period. This exists today (`COVERAGE_NOT_ACTIVE`).
2. There is still balance to pay. This is the member balance check (`MEMBER_BALANCE_PRD.md`).
3. The claimed items are not under an exclusion. This PRD covers point 3.

Today the system has one exclusion check, `POSSIBLE_EXCLUSION`. The AI compares the diagnosis with the general policy exclusion clauses, and a possible match is only a warning for the approver. It never stops the case.

IAS now offers `POST /api/get_member_policy_events`. It returns the exclusions that IAS holds for this member and for this policy period, as two lists of events. Each event has a date and a free-text description, and no code. So the system must judge by meaning whether the claim falls under an event.

## 2. Goals and non-goals

Goals:

1. Before the document check, the AI judges by meaning whether the claim falls under any member exclusion or policy exclusion that IAS holds.
2. A likely match, or an unsure answer, stops the case at member review for a person, before the customer is asked for documents.
3. Each finding says whether the exclusion is at member level or at policy level.
4. The same backend logic runs in the email flow and the API flow, inside the member check.

Non-goals:

1. Rejecting a claim. A person decides.
2. Replacing the general policy-clause check (`POSSIBLE_EXCLUSION`). It stays as a warning beside the new check (owner, 2026-10-26).
3. Checking exclusions again at claim preparation. Exclusions rarely change while a case waits.

## 3. Users

| User | Use |
|---|---|
| Reviewers (CSR / Ops) | See the exclusion finding with its level, the event and the AI's reason. Bypass it with a reason |
| Approver (JD3) | Sees the exclusion events and the decision in the assessment summary |
| Customer | Is not asked for documents on a claim that a person has not cleared for exclusions |

## 4. Requirements

### 4.1 Where it runs

The exclusion check runs inside the member check, in `member-verification/service.js` `checkCase`, for both flows. It runs after IAS finds the member, beside the balance check. If IAS does not find the member, it does not run.

### 4.2 The request

All values come from the IAS member information answer that the member check already has:

| Request field | Source |
|---|---|
| `policyNo` | `payload.policies[0].POCY_NO` |
| `policyRefNo` | `payload.policies[0].POCY_REF_NO` |
| `memberNo` | `payload.member.MBR_NO` |
| `memberRefNo` | `payload.member.MBR_REF_NO` |
| `policyEffDate` | `payload.policies[0].EFF_DATE`, converted from `MMDDYYYY` to `YYYY-MM-DD` |

The spec accepts either identifier of each pair. When both are sent, both must match. The system sends `policyNo` and `memberNo`. If a number is missing, it sends the reference number instead.

The call uses the shared IAS POST helper in `member-verification/iasClient.js`: a time-out, and a thrown error on a network failure or a non-2xx answer. A new configuration value `GET_MEMBER_POLICY_EVENTS_API` holds the endpoint path. If the call fails, the member check fails for that run and runs again next time, the same as the balance call. If IAS answers `success: false`, the check is "not checked", the reason is kept, and the case is not stopped for it.

### 4.3 Which events count

1. Both lists are read: `memberEvents` (level *Member*) and `policyEvents` (level *Policy*).
2. These events count: an event with an `eventDate` on or before the treatment date, and an event with no date (owner, 2026-10-26). The treatment date is the accident date, or the visit date. An exclusion added after the treatment does not count.
3. An event with no description cannot be judged. It is listed for the reviewer, but no AI call is made for it.
4. If no event counts, the check passes with no AI call.

### 4.4 Judging by meaning

1. One AI call per case judges all the counted events together, by meaning only (owner, 2026-10-26). It gets what the claim is for, from the fields read from its documents: the diagnosis and treatment text, the voucher lines, and whether the treatment was outside Myanmar. It gets no dates. For each event, it gets the level and the description. Burmese text is translated first, as the member check already does for the head pick.
2. The answer is one result per event: whether the claim falls under it (`applies`: yes or no), a confidence from 0 to 1, and a short reason in plain words.
3. The AI does no date reasoning on the free text (owner, 2026-10-26). It ignores a date or time limit written in a description, such as "18th NOV" or "for 1st yr". If a rule matches the claim's meaning and has a date or time limit, the rule applies, and the reason says that a person checks the date. The only date the system uses is the event's own `eventDate` (4.3).
4. Events are not only medical exclusions (IAS samples, Q6). The prompt covers three kinds of event:
   - A condition or treatment excluded, for example "ASTHMA for 1st yr". Any asthma claim matches, and a person checks the first year.
   - A policy or cover that ended, for example "No further claims to be accepted, 18th NOV". It matches every claim, and a person checks the date.
   - A rule on where the treatment or the member is, for example "claims only from India, Malaysia and Thailand". A treatment inside Myanmar does not match. A treatment outside Myanmar is unsure, because no country name is read.

5. A new prompt file, `member-verification/prompts/exclusion-events.md`, holds the instructions. The call goes through the existing AI client and the AI call log (`llm-calls`), like every other AI judgment.
6. If the AI says that an event applies, the event is a likely match. If the confidence is at or below the AI confidence threshold (System page), the event is unsure. Both stop the case (owner, 2026-10-26).

### 4.5 The outcome

The order inside the member check stays as in the balance PRD: member problems first, then unsure heads, then the balance. The exclusion finding is one more member problem.

| Situation | Email flow status | API flow status | What happens |
|---|---|---|---|
| Any counted event is a likely match or unsure | `MEMBER_REVIEW_REQUIRED` | `API_MEMBER_REVIEW_REQUIRED` | A member finding `member:exclusion` (reason code `POSSIBLE_MEMBER_EXCLUSION`). The case waits for a person, and the team is emailed. The customer is not emailed |
| No counted event matches | as today | as today | The case goes on. The events and the AI's reasons are shown to the reviewer |

The finding names each matching event with its level:

```
Member exclusion (2026-02-15): "Pre-existing diabetes and its complications" — the claim's diagnosis is diabetes follow-up (0.92)
Policy exclusion (no date): "Dental treatment excluded for this group" — not sure (0.55)
```

### 4.6 The finding on the member review panel

The exclusion finding works like the balance finding:

1. It is listed on the member review panel of the case page and the review workspace, one line per matching event.
2. The only action is *Bypass*, with a required reason. The bypass is recorded as an exception, never as an AI mistake.
3. A bypass covers the events that the person saw, by their event ID and level. If IAS adds a new exclusion event that matches, the finding is raised again.
4. A case at member review is checked again on every run. If IAS removes the event, the finding clears by itself.
5. `member:exclusion` joins the member findings that a person can set aside (`ACCEPTABLE_MEMBER_ITEMS` in `checks.js`).
6. A claim whose exclusion finding was bypassed or overridden never goes STP. A person (JD3) approves it.

### 4.7 What people see

1. The assessment summary (case page, team emails, IAS remark) gets a line *Exclusions in IAS*: the counted events by level, and for each one the AI's answer and reason. If the check did not run, the line says why.
2. The AI checklist page gets one member check entry: *Is the claim under a member or policy exclusion in IAS?* (`member:exclusion`). It can stop the case and uses the AI. A reviewer can bypass it with a reason.
3. The existing `POSSIBLE_EXCLUSION` warning stays, and its AI checklist entry says it compares with the general policy clauses.

### 4.8 Sample events from IAS (Q6)

These real descriptions are the prompt's test cases (phase A). All three are member events (owner, 2026-10-26). ULINK staff type exclusions by hand on the member record, so a member event can hold any kind of rule: a condition, a cut-off date, or a rule on where the treatment or the member is. The prompt must not assume that a member event is medical, or that a policy event is administrative. Member events have no policy period, so an event from an earlier period still comes back. The date rule (4.3) and the AI's reading of the event decide whether it still applies.

| Sample | Kind | How the AI judges it |
|---|---|---|
| "1. ASTHMA for 1st yr 2. Any symptom related to GERD 3. DRT testing" | Conditions, one for a time | It applies to a claim for asthma, a GERD symptom (by meaning: acid reflux, heartburn), or DRT testing. For asthma, the reason says that a person checks the first year. Several exclusions in one event: the reason names the one that applies |
| "Policy Terminated or expired in the system. No further claims to be accepted, 18th NOV" | Policy ended | It applies to every claim. The reason says that a person checks the date (18 November) |
| "1. The diagnosis and claim can only be accepted from India, Malaysia, and Thailand.,2. The policy will be canceled once the insured decides to leave Myanmar permanently or if their visa is no longer valid.,3. If the life assured remains outside of Myanmar for a period of more than one hundred eighty-five (185) consecutive days, then the policy will be terminated." (quoted as IAS gave it) | Where the treatment or the member is | Treatment inside Myanmar: does not apply. Treatment outside Myanmar: unsure (no country name is read), so a person checks the country. The claim cannot answer the residency and visa rules. The AI answers unsure for them only for a claim with treatment outside Myanmar |

## 5. New settings and data

1. A new configuration value `GET_MEMBER_POLICY_EVENTS_API=/api/get_member_policy_events`, in `.env`, `.env.example` and `.env.uat`.
2. The member check result (`memberVerifyResult`) holds `exclusions`: `{ checked, note, events: [{ eventId, level, eventDate, description, counted, applies, confidence, reason }] }`. No new table.
3. A saved AI answer is reused while the events and the claim text are unchanged. A case that waits at member review then does not call the AI again on every run.

## 6. Risks

1. The AI reads free text, so it can be wrong in both directions. A false match stops a good claim until a person bypasses it. A missed match is the same risk as today, where the general check is only a warning.
2. The spec's sample description is generic ("Member exclusion details."). The prompt can only be tuned after seeing real event descriptions from UAT.
3. More cases stop at member review. The AI checklist switch can turn the check off (Q2).

## 7. Open questions

| No. | Question | For | Answer or proposed default |
|---|---|---|---|
| Q1 | Does a likely match stop the case at member review, with Bypass only? | Owner | Decided 2026-10-26: yes |
| Q2 | Is `member:exclusion` locked on the AI checklist page, or can it be switched off? | Owner | Decided 2026-10-26: it can be switched off, because it is an AI judgment. A switched-off check blocks STP (the AI checklist rule) |
| Q3 | Does the general policy-clause check stay as a warning? | Owner | Decided 2026-10-26: yes, and the new check names the level (member or policy) |
| Q4 | Do events dated after the treatment date count? | Owner | Decided 2026-10-26: no. Only events on or before the treatment date, or with no date |
| Q5 | Does an unsure AI answer stop the case? | Owner | Decided 2026-10-26: yes |
| Q6 | Can IAS give one or two real `eventDescription` examples from UAT? | IAS | Answered 2026-10-26 with three samples (section 4.8). They are the prompt's test cases |
| Q7 | Which identifier does the call use: `policyNo` (`POCY_NO`) or `policyRefNo` (`POCY_REF_NO`)? | IAS | Decided 2026-10-26: `policyNo` and `memberNo`, with the reference numbers as a fallback |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with the `ulink-api` tests passing, `ulink-console` building, a code review, and a suggested commit message and file list.

| Phase | Content | Needs first | Status |
|---|---|---|---|
| A. IAS client, events and judge | `getMemberPolicyEvents` client and the `GET_MEMBER_POLICY_EVENTS_API` value. A pure function for the request and the counted events (date rule, levels). The AI judge with its prompt, tested on sample events with a faked AI answer. No change to any case | Owner approves this PRD | Done, awaiting review (2026-10-26) |
| B. In the member check | The check inside `checkCase` (both flows). The `member:exclusion` finding with Bypass only, covering the events by ID and level. AI answer reused while nothing changed. No STP after a bypass or override. The summary line. The AI checklist entry | A done, Q2 | Not started |
| C. Docs | `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the API flowchart and its published page, the change log | B done | Not started |
