# ulink-console — Dashboard System Design

Written 2026-09-28 from the current console and the 17/09 meeting
(`Ulink_AI_Claims_Automation_Meeting_Summary_Action.docx` — point 5, #7, #8, #9, #10, #11).
Related: [SUMMARY_REQUIREMENT.md](SUMMARY_REQUIREMENT.md).

---

## 1. Purpose

`ulink-console` started as a prototype: a pipeline graph for developers and a simple case review. It becomes the
**internal dashboard web system** for Ulink users (CSR / Ops / JD2 / managers), in the style of an admin template
such as **SB Admin**: left sidebar, top bar, content made of cards and tables — with **one simple page per claim
module**, so each team sees only what it needs.

The meeting's split (point 5, #8): the **dashboard is where everything is visible** (monitoring + every
exception); **email only nudges** people about the exceptions that need them.

## 2. Design principles

1. **Organised by how people work, not by pipeline step.** Steps (intake, recognition, …) are the orchestrator's
   view; pages are Overview, Review queue, Approvals, Cases. Step shows up only as the Cases page's filter and
   column (the Overview's "Cases by step" table was removed 2026-09-28 for the same reason).
2. **Plain language.** No status codes or field paths for business users; always show *why* (AI Assessment).
3. **Read-only first.** Pages that only show data come first; anything that changes data waits for login + roles.
4. **One brain.** Explanations come only from the assessment-summary builder (API); pages never re-derive them.
5. **Same stack.** React + Tailwind + React Query + React Flow as today. SB Admin is the *layout pattern*, not a
   new dependency or template import.
6. **Developer tools stay — nothing is removed.** The pipeline tool (graph, Email / API tabs, run pipeline,
   "Run this step", completion alert, live run status) and everything job-related (Job Steps, raw JSON,
   override / reset) keep working exactly as today. They only move: the graph from the home page to its own
   sidebar item (Admin › Pipeline), job details behind the case page's "Technical details" toggle. Limiting who
   sees them comes only with login + roles (step 7); until then everyone sees everything, as today.

## 3. Layout (SB Admin pattern)

```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│  ULINK       │  Top bar: page title · search case / claim no · user & role   │
│              ├──────────────────────────────────────────────────────────────┤
│  DASHBOARD   │                                                              │
│   Overview   │   [ card ] [ card ] [ card ] [ card ]      ← key numbers      │
│              │                                                              │
│  MY WORK     │   ┌──────────────────────────────────────────────────────┐   │
│   Review Q.  │   │ Needs attention (table)                               │   │
│   Approvals  │   └──────────────────────────────────────────────────────┘   │
│              │   ┌──────────────────────────────────────────────────────┐   │
│  MODULES     │   │ Recent cases (table)                                  │   │
│   Intake     │   └──────────────────────────────────────────────────────┘   │
│   Recognition│                                                              │
│   Member     │                                                              │
│   Documents  │                                                              │
│   Claim/IAS  │                                                              │
│   STP & CSR  │                                                              │
│   Emails     │                                                              │
│              │                                                              │
│  CASES       │                                                              │
│   All cases  │                                                              │
│              │                                                              │
│  ADMIN       │                                                              │
│   Pipeline   │                                                              │
│   Settings   │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

Every page has an **Email / API / All** source filter (the existing `SourceTabs`).

## 4. Pages

| Sidebar group | Page | For | What it shows | Meeting |
|---|---|---|---|---|
| Dashboard | **Overview** | Everyone | Cards: new claims today, STP rate, waiting on customer, needs review, failed. Trend by day. Links into each module | Point 5, #8 |
| My work | **Review Queue** | CSR / Ops | Cases needing a human, grouped by review reason (AI unsure · Unreadable · Data mismatch · Missing · Rule hold · System), oldest first | #7, HITL |
| My work | **Approvals** | JD2 | Non-STP claims waiting for approval, each with its AI assessment | #10 |
| Modules | **one page per module** (section 5) | Team owning it | That module's numbers, its exceptions, its recent cases | #8 |
| Cases | **All cases** + **Case page** | Everyone | Existing list; case page = reviewer view (assessment, documents, emails) + "Technical details" toggle | #9 |
| Admin | **Pipeline** | Admin / dev | Existing graph and run controls (today's home page moves here) | — |
| Admin | **Settings** | Admin | STP limits / rules; later: who receives which alert | #11, #8 |

## 5. Steps (modules) — mapping only

> **Update 2026-09-28:** no per-step pages (build step 4 dropped). The mapping below is still used — status
> catalog and the Cases "Step" filter / column (the Overview's "Cases by step" table was also removed). The
> card/table template is kept for reference.

### Original idea: one template

Every module page = **3 cards + 2 tables**, filtered to that module's cases:

| Part | Content |
|---|---|
| Card 1 | Processed today |
| Card 2 | Waiting (at this step now) |
| Card 3 | Exceptions (need a person) |
| Table 1 — Needs attention | Cases this module flagged: case, claim no, source, age, first review point → case page |
| Table 2 — Recent | Latest cases through this module and their outcome |

Modules and the statuses they own (email / API):

| Module | Email statuses | API statuses | Exceptions |
|---|---|---|---|
| Intake | `EMAIL_RECEIVED`, `ATTACHMENTS_STORED` | `API_RECEIVED`, `API_MATERIALS_DOWNLOADED`, `API_NO_DOCUMENTS` | No documents |
| Recognition (OCR) | `READY_FOR_DOCUMENT_READING`, `RECOGNIZED`, `NOT_RECOGNIZED`, `MANUAL_REVIEW` | `API_REPLY_RECEIVED`, `API_RECOGNIZED`, `API_MANUAL_REVIEW` | Not recognised, manual review |
| Member verification | `MEMBER_REVIEW_REQUIRED` | `API_MEMBER_REVIEW_REQUIRED` | Member / bank / coverage issue |
| Document checking | `READY_FOR_DOCUMENT_CHECKING`, `INCOMPLETE`, `MEMBER_VERIFIED` | `API_READY_FOR_DOCUMENT_CHECKING`, `API_INCOMPLETE`, `API_DOCUMENTS_VERIFIED` | Missing / unreadable documents |
| Claim preparation & IAS | `DOCUMENTS_UPLOADED`, `CLAIM_PAYLOAD_PREPARED`, `CLAIM_CREATED`, `CLAIM_SUBMIT_FAILED` | `API_CLAIM_PAYLOAD_PREPARED`, `API_CLAIM_REVISED`, `API_CLAIM_SUSPENDED`, `API_CLAIM_REVISION_FAILED` | IAS rejection |
| STP & CSR | `CSR_SENT` | `API_AWAITING_CSR`, `API_CSR_SENT` | CSR not ready for long |
| Customer emails | Email tasks (all types) | `api-email-sender` steps | Failed / bounced sends |

This mapping lives in `ulink-api/modules/case-status/catalog.js` (built 2026-09-28): each code has a label (badge), a
description (hover), a module and a group (In progress · Waiting on customer · Needs review · Done · Failed). It
replaced the console's incomplete `caseStatusBuckets.ts`; a test fails if a job sets a status the catalog lacks.

## 6. Roles

| Role | Sees | Can do (later, after login) |
|---|---|---|
| CSR / Ops | Overview, Review Queue, Modules, Cases | Confirm, Request from customer, Escalate |
| JD2 | Overview, Approvals, Cases | Confirm, Correct, then approve in IAS |
| Manager | Overview, Modules, Cases | Read only |
| Admin / Developer | Everything | Override / reset, Run step, Settings |

Today there is **no login** and **override / reset are open to anyone** on the case page — to fix before internal
users get access.

## 7. Current → target

| Today | Target |
|---|---|
| Top tabs: Pipeline, Cases | Left sidebar with groups (section 3) |
| Home = pipeline graph | Home = Overview; graph → Admin › Pipeline |
| Status buckets in the console (`caseStatusBuckets.ts`) | One module / status mapping on the backend (section 5) |
| Case page mixes reviewer and developer content | Reviewer view + "Technical details" toggle |
| Override / reset visible to all | Admin-only |
| No review queue, approvals, module pages, settings | Added as read-only pages first |
| No login | Login + roles before any write action |

## 8. Build order

| Decide | # | Step | Type | Needs decision |
|---|---|---|---|---|
| [x] | 1 | Layout shell (built 2026-09-28): sidebar + top bar, move Pipeline under Admin (`/pipeline`), keep existing pages working | UI only | — |
| [x] | 2a | Status catalog (built 2026-09-28): every status code → label, description, module, group (`modules/case-status/catalog.js`, `GET /api/cases/statuses`); console shows labels, codes stay internal | Read-only | — |
| [x] | 2b | Overview page (built 2026-09-28): home page, cards per group (who acts next) + received today — the cases-by-step table was removed the same day (steps are the orchestrator's view); every number links to the filtered Cases list (`GET /api/cases/overview`) | Read-only | — |
| [x] | 2c | Data table (built 2026-09-28, `components/common/DataTable.tsx`): search, sortable columns, paging, group + step filters, all kept in the URL; cases API gained `q`, `group`, `module`, `sort`, `dir` | Read-only | — |
| [x] | 3 | Review Queue (built 2026-09-28): needs-review statuses, IAS rejections, and open cases with an assessment point for the team; grouped by most serious reason, oldest first (`modules/review-queue/queue.js`, `GET /api/cases/review-queue`, `/review`); sidebar count moved here | Read-only | — |
| ~~[ ]~~ | 4 | ~~Module pages~~ — **dropped 2026-09-28**: steps are the orchestrator's view, not how people work (CSR/Ops use the Review queue, JD2 Approvals, managers the Overview). Step visibility stays only in the Cases "Step" filter / column | — | — |
| [x] | 5 | Case page (built 2026-09-28): reviewer view (status in words + description, AI assessment, documents, emails, plain history) + "Technical details" toggle (checklists, raw data, job steps, codes); reset / override moved to Admin actions, shown to super admins only (the `VITE_ADMIN_TOOLS` flag was replaced by the login role in step 7) | UI only | — |
| [x] | 6 | Approvals (built 2026-09-28): non-STP claims waiting for JD2 in IAS (email `CLAIM_CREATED` non-STP, API `API_CLAIM_REVISED`), oldest first, with the AI review points (`GET /api/cases/approvals`, `/approvals`). The system can't see JD2's approval in IAS yet — claims stay listed until a status check or an "Approved" action (step 8) exists | Read-only | — |
| [x] | 7 | Login (built 2026-09-28): username + password, JWT for 8 hours kept in sessionStorage; one role `super_admin`; all API routes need login except `/api/auth/login`, health and the pipeline / job routes (cron); reset / override and `/api/dev` are super-admin only and record the logged-in user; users managed by command (`npm run user:create / user:reset-password / user:disable / user:enable`); failed logins rate-limited per IP | Access | — |
| [ ] | 8 | Reviewer actions + audit log | Write | SUMMARY_REQUIREMENT decisions 2, 3 |
| [ ] | 9 | Settings: STP rules | Write | Decision 4 |

Steps 1–6 are safe to build now. 7–9 wait for decisions.

## 9. Decisions needed

| Decide | # | Question |
|---|---|---|
| [x] | 1 | **Login method** — decided 2026-09-28: manual username + password, JWT (8 h, sessionStorage); no SSO / two-factor for now |
| [ ] | 2 | **Roles** — only `super_admin` for now (demo stage, first user `ulink`). Still open: which future roles (CSR / Ops / JD2 / Manager) and what each may see / do |
| [ ] | 3 | **Overview numbers** — which matter most to Ulink (volume, STP rate, turnaround time, waiting on customer, failures)? |
| [ ] | 4 | **STP rules in Settings** — which parameters should be editable, and by whom (#11)? |
| [ ] | 5 | **Pipeline page** — developers only, or Ops too? |
