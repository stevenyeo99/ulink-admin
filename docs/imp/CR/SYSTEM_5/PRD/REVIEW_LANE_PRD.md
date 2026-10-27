# SYSTEM_5 PRD: a review lane for cases a person decided

Owner: Steven Yeo. Written: 2026-10-27. Status: draft, for the owner's review.
Source: client feedback at the 4th demo. "A case that a reviewer marked OK or revised must go on at once, in its own job." It must not wait for the next run of the whole pipeline.

## 1. Background

Each flow has one pipeline. Cron starts it on a schedule: the API flow at :07 and :37, the email flow every 10 minutes (`docs/deployment/CRONTAB_SETUP.md`). One run goes through every job in a fixed order (`modules/pipeline/service.js`). Each job takes a batch of the cases that wait at its input status.

This design was made for new cases, which the AI handles first. Since SYSTEM_4, a person decides every failed or unsure case on the review page (human in the loop). After the save, three things slow the case down:

1. The save only moves the case back to an earlier status, for example `API_RECOGNIZED` (`recheckFrom`, `ai-feedback/corrections.js`). The case then waits for the next cron run, up to 30 minutes.
2. In that run, the case waits behind the slow jobs that come first, such as the AI reading of new cases.
3. Each job takes the oldest cases first (`runApiJob.js`, `updatedAt` ascending). The save made the case the newest, so it comes last, and a full batch pushes it to another run.

While the case waits, it stays in the review queue with the same points, because the stored check results are still the old ones. A second reviewer can do the same work again.

## 2. Goals and non-goals

Goals:

1. A case that a person decided goes on within minutes, in its own lane, in both flows.
2. New cases keep the existing pipeline, which does not change.
3. A decided case leaves the review queue. If the new check finds new points, it comes back.
4. People can see the decided cases, follow them, and run them again by hand.

Non-goals:

1. A change to how new cases are processed, or to the order of the existing batches.
2. A websocket or other live connection.
3. A "Run all" button.

## 3. Words used in this PRD

| Word | Meaning |
|---|---|
| Lane 1 | The existing pipeline of a flow: `pipeline` (email) and `api-pipeline` (API). It processes new cases. |
| Lane 2 | The new review pipeline of a flow: `review-pipeline` (email) and `api-review-pipeline` (API). It processes decided cases. |
| Decided case | A case with the marker `review_pending_at` set |
| Round | One pass of lane 2 through its jobs |

## 4. Requirements

### 4.1 The marker

1. A new column `review_pending_at` (timestamp, null by default) on `ulink_cases`, with the person who set it (`review_pending_by`).
2. These actions set it, in both flows. Each action already moves the case to an earlier status:

   | Action | Where |
   |---|---|
   | Save of corrections: Mark OK, Mark wrong, Revise, Bypass, contract exclusion answers | Review page, `POST /api/cases/:id/corrections/batch` |
   | Override, and *Confirm and continue* | Case page, `POST /api/cases/:id/override` |
   | *Send the request to the customer* | Case page, release of the missing-documents email |
   | Benefit choice | *Choose the benefit* panel |
   | Claim preparation choices, and the balance bypass | Claim preparation panel |
   | Case-page upload | Case page, `API_UPLOAD_RECEIVED` |

   Mark OK on an unsure value alone does not move the case, so it does not set the marker.
3. If lane 2 moves the case to a status in one of these groups, the marker is cleared. It is cleared in the same transaction as the status change.

   | Group | Statuses (API flow. The email flow has the same groups) |
   |---|---|
   | Stops for a person (`needs_review`, `failed`) | For example `API_MEMBER_REVIEW_REQUIRED`, `API_DOCUMENTS_REVIEW`, `API_PREPARATION_REVIEW`, `API_CLAIM_REVISION_FAILED` |
   | Waits for the customer (`waiting_customer`) | `API_NO_DOCUMENTS`, `API_CLAIM_SUSPENDED` |
   | Ends (`done`) | `API_CLAIM_REVISED`, `API_CSR_SENT` |
   | Waits for an outside system (statuses of the `in_progress` group) | `API_CONSOLE_BARCODE_PENDING`, `API_AWAITING_CSR`, for older cases `API_DOCUMENTS_UPLOADED`, and in the email flow `CONSOLE_BARCODE_PENDING` |

   After that, lane 1 handles the case as today, for example console watch, barcodes and the settlement report.
4. A test makes sure that each status of both flows is in a group of the table. It also makes sure that every status that lane 2 can reach clears the marker or is an input status of a lane 2 job.

### 4.2 Lane 1 (existing pipeline)

1. Every job of lane 1 takes only cases with no marker.
2. The steps, their order, the batches, the cron and the locks do not change.

### 4.3 Lane 2 (review pipeline)

1. Lane 2 runs the same jobs as lane 1, in the same order, for its own flow. It takes only marked cases.
2. At the end of each round, lane 2 also sends the emails of its own cases (team emails, customer emails). So they do not wait for lane 1.
3. Lane 2 has its own pipeline lock. Its jobs take no job lock, because the lane lock keeps its rounds apart and lane 1 never takes its cases. Only its email step takes the same lock as lane 1's sender, so the two never send the same email at once. Lane 1 and lane 2 never wait for each other otherwise.
4. A case still marked 30 minutes after the decision, for example because a job keeps failing, is no longer marked. Lane 1 then takes it on its next run, and the server log names it. A reset or a retry also clears the marker.
5. The selected cases of a manual run (4.6) come first in a round. The other marked cases follow, oldest decision first.
6. The pipeline history in the console shows lane 2 runs with the label *Review lane*. A round with no marked case writes no run.

### 4.4 Triggers for lane 2

1. Save: after every action in 4.1.2, the API starts a lane 2 round in the background.
2. Retry cron: every 3 minutes (`*/3 * * * *`), for each flow. It catches a case whose round failed, for example because IAS did not answer.
3. Manual run: from the *Reviewed* page (4.6).

### 4.5 Concurrency

1. Only one lane 2 round works at a time in each flow.
2. A trigger that comes while a round is busy sets a *run again* flag. When the busy round ends, it checks the flag. If the flag is set, the round clears it and runs once more. No trigger is lost.
3. A case can never be processed twice at once. Lane 1 never takes a marked case. Inside lane 2 only one round works. If a case is no longer at the status where a job took it, the job does not move it (as today in `runApiJob.js`).
4. A lane 2 lock older than 15 minutes counts as stale. The next trigger takes it over and writes a log line.
5. While a case is marked, the API refuses a new correction, override or choice on it with "This case is being checked again. Wait until it finishes."
6. The Save releases the reviewer's hold on the case (`CaseClaim`).

### 4.6 The Reviewed page

1. A new sidebar item *Reviewed*, in the *Work* section, after *Review queue*, at `/reviewed`. It shows a count of the decided cases. If a case waits longer than the time limit (4.6.5), the count is red.
2. The page has the tabs Email, API and All (`SourceTabs`), and a table with one row for each decided case:

   | Column | Content |
   |---|---|
   | Case | Claim no., claimant, source |
   | Decision | What, who and when, for example "Mark OK on Hospital name, by Thin Zar, 10:42" |
   | Now | The current step, for example *Checking documents* |
   | Waiting | Time since the decision |
   | Last round | *Running*, *Waiting for the next round*, or *Failed* with the error |

3. Super admins see *Run now* on each row, and *Run selected* above the table with a checkbox on each row (at most 20 cases).
4. A manual run is refused for a case with no marker, with the reason. Each manual run writes a case event, for example "Run again by Thin Zar, 10:45".
5. If a case waits longer than 15 minutes, its row is highlighted (a fixed value). After 30 minutes the lane gives the case back to lane 1 (4.3.4), so it leaves the page.
6. A new endpoint `GET /api/cases/reviewed` feeds the page. A manual run is `POST /api/cases/reviewed/run` with `{ caseIds: [...] }`, behind login. The job routes `POST /api/jobs/api-review-pipeline/run` (and later `/api/jobs/review-pipeline/run` for email) take no body: they are open for the retry cron.

### 4.7 Review queue

1. A marked case is not listed in the review queue, and it is not counted in the sidebar count of the review queue.
2. When lane 2 clears the marker at a stop for a person, the case comes back to the review queue with its new points.

### 4.8 The page after Save

1. After Save, the page says "Saved. The case is being checked again. You can follow it on the Reviewed page." The main button is *Next case*. A second button is *Stay on this case*.
2. A marked case opens read-only, with a banner, for example "Being checked again after your decision: Checking documents, 1 min". The decision buttons are off.
3. When the round ends, the banner says the result, for example "Done: the claim went to IAS", or "Needs review again: 1 new point", and the buttons come back on.
4. The case page and the *Reviewed* page poll the API every 5 seconds while a case is marked (react-query `refetchInterval`). Otherwise they do not poll.

### 4.9 Alerts

1. If cases are marked and no lane 2 round ran for 15 minutes, the pipeline health widget (`PipelineHealth.tsx`) shows a warning.

## 5. API and data

1. One migration adds `review_pending_at`, `review_pending_by` and an index on `review_pending_at` to `ulink_cases`.
2. One row in the job lock table (`ulink_job_locks`) for each lane 2 holds the *run again* flag, in a new column `rerun_requested_at`. One migration adds it.
3. No new System settings value. The highlight limit (15 minutes) and the give-up limit (30 minutes) are fixed.
4. New endpoints: 4.6.6.
5. Two new cron lines on each server (4.4.2). `CRONTAB_SETUP.md` gets them as a reusable step for UAT and prod.

## 6. Risks

1. Both lanes share the LM Studio model. AI calls are slower while both lanes run. The AI calls of lane 2 are few, such as the exclusion judgment and the diagnosis pick.
2. If the retry cron is missing on a server and a background round fails, decided cases stop moving. Lane 1 does not take them. The alert (4.9) and the highlighted rows (4.6.5) show this.
3. A status added later must be put in a group of 4.1.3. The test in 4.1.4 makes sure that this is not forgotten.

## 7. Open questions

| No. | Question | For | Proposed default |
|---|---|---|---|
| Q1 | Is 3 minutes right for the retry cron? | Owner | 3 minutes |
| Q2 | Is 30 minutes right for a highlighted row? | Owner | 30 minutes |
| Q3 | Can a reviewer (not a super admin) see the *Reviewed* page? | Owner | Yes, but only super admins see the run buttons |

## 8. Implementation plan

The owner approves one phase at a time. Each phase ends with these steps: the `ulink-api` tests pass, `ulink-console` builds, a code review runs, and a commit message and file list are suggested.

| Phase | Content | Status |
|---|---|---|
| A. API lane | Migrations, marker set and clear, lane 1 filter, API review pipeline with its locks, Save trigger, run again flag, stale lock, refusal while marked, review queue rule, tests | Done, awaiting review (2026-10-27). The migration must still run on dev (DNS failed on 2026-10-27). Email cases are not marked yet (phase B) |
| B. Email lane | The email review pipeline, with the same rules | Done (2026-10-27). One hook on the case model clears the marker for every job of both flows. Migration `20261027120000-email-review-lane` (run on dev) |
| C. Reviewed page | Sidebar item, page, endpoints, manual runs, page after Save, banner, polling, health alert | Done (2026-10-27). Run now and Run selected for API cases only, until phase B |
| D. Server and docs | Retry crons in `CRONTAB_SETUP.md`, `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the API flowchart and its published page, the change log. Done together with the review actions PRD, phase E (with the reviewer guide) | Done (2026-10-27). The retry cron lines still have to be installed on UAT with the release |
