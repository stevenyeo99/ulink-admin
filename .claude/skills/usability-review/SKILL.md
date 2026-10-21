---
name: usability-review
description: Usability review of the ULINK claims console (src/ulink-console). Use when the user asks to review a page, a flow or a UI change for ease of use, or asks "is this easy for the user". Source of truth for roles and tasks is docs/reverse-prd.md.
---

# Usability review of the ULINK console

The console is the human-in-the-loop dashboard: the AI does the claim work, and a person steps in only where the AI may be wrong. Judge each screen by one question. Can the person see why the case stopped, the evidence, what the AI read, and the one action to take?

## Users and their context

| Role | Context | Main screens |
|---|---|---|
| Claims team (CSR / Ops) | Works many cases a day. Knows claims, not the system's internals. | Review queue, review workspace, case page |
| JD3 (approver) | Approves non-STP claims in IAS. Reads, does not edit. | Approvals, case page |
| Administrator | Runs the pipeline and changes rules. Knows the system. | Pipeline, STP settings, System settings |

All logins are `super_admin` today, so judge each screen by the business role that uses it.

## Core tasks that must be easy

1. Find the next case to work and see why it stopped (review queue, "Next:" box).
2. Clear a stop: correct a misread value, mark a finding, or override with a reason (review workspace).
3. Handle missing documents: continue as missing, or upload them on the case page.
4. Decide the claim preparation stop: diagnosis code, voucher benefit, manual rejection, in one save.
5. JD3 finds a claim and reads what to look at before approving (Approvals).

## Review checklist

Read the page code and, where possible, the running page. For each screen in scope, look for:

- Unclear starting point: no clear first thing to read, or the reason the case stopped is not on top.
- Internal terms in labels: status codes (`API_DOCUMENTS_REVIEW`), field paths (`invoices.items.0.date`), job names, "verdict", "payload", "R69" without its meaning.
- Unhelpful empty states and errors: "No data", a raw API error, or no next step for the reader.
- Missing success feedback: after a save, no message says what happened and what comes next ("checked again on the next run").
- Unclear main action: several buttons of equal weight, the same action on two pages, or a button that does not say its result.

Also note text that contradicts the case, for example a reason or an email promise that does not match the stop.

## Output

Rank each issue High, Medium or Low. High blocks or misleads a core task. Medium slows it. Low is polish.

| Rank | Screen | Problem | Suggested fix |
|---|---|---|---|
| High | Review workspace | ... | ... |

Add the file and line for each issue (`file_path:line`). End with the three fixes that give the most value for the least change. Do not change code during the review.
