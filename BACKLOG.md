# ulink-admin — Backlog

What is next, in order. Business items keep the IDs of the owner's tracker
([20260917_enhancement_status.md](docs/imp/demo/API%20DAY1/PREV_FEEDBACK/20260917_enhancement_status.md), section 4),
which stays the record of meeting points and their status. This file adds the engineering and scaling work the
tracker doesn't hold. When an item is done: remove it here, add a dated row to the tracker's change log.

Size: S ≤ ½ day · M ≈ 1–2 days · L > 2 days.

---

## Now — before the demo

| ID | Item | Size |
|---|---|---|
| N1 | Run migrations on every environment (`npm run db:migrate`) and restart | S |
| N2 | Rehearse from `docs/imp/demo/API DAY1/ULINK_Demo_Rundown.docx`; set STP values and switches (its decisions A–E) | S |
| N3 | Browser check: STP settings (rules + switches), journey panel, "send the request" button, Console Barcode node | S |
| N4 | Live check of cl-upload with one email case (requirement step 8), then decide `CONSOLE_UPLOAD_METHOD` | S |

## Next — no decision needed

| ID | Item | Why | Size |
|---|---|---|---|
| E1 | Override for **API** documents incomplete (not held): revision with `isSuspense=N` + reason | AI wrongly suspends an API claim; today only a reply or IAS fixes it | M |
| E2 | "Re-check this case" — re-run claim preparation after an STP rule change, without a full reset | Rule changes only reach new cases today | S |
| E3 | Barcode lookup: follow `hasMore` pages | A case with many uploads could miss a barcode | S |
| E4 | API case: check for new console images when the customer uploads again instead of replying by email | Today new documents arrive only through an email reply | M |
| E5 | Retire stale docs: `MEETING_20260917_ACTION_STATUS.md`, `SUMMARY_REQUIREMENT.md` (point to the tracker and `CLAIM_FLOW_END_TO_END.md`) | Two docs disagree with the code | S |
| E6 | Remove the committed Word lock file `docs/imp/demo/API DAY1/PREV_FEEDBACK/~$ink_…docx`; ignore `~$*` | Repo hygiene | S |
| E7 | Load exclusion clause wording in the summary from the DB table rather than `scripts/seeds/` | A module should not depend on a seed script | S |

## Waiting on a decision (tracker IDs)

| ID | Item | Decision | Owner |
|---|---|---|---|
| B1 | Team email for "Needs manual reading" | Email vs dashboard (#8) | Ulink |
| B2 | Burmese customer emails | Scope + approved wording | Ulink |
| B3 | Real STP values; PA; switch #1 on or off; who edits | Final STP parameters | Ulink |
| B4 | Random audit sample of STP claims | Audit % | Ulink |
| B5 | Reviewer actions: confirm / correct / request from customer / escalate / "send back as incomplete" | Who can act; does iAS update | Ulink |
| B6 | AYAS delegation (different account holder) as a payment rule | Exception list | Dr KP / Ulink |
| B7 | Attachment storage location and retention | Ulink + DRT/IT | Ulink |
| C2 | cl-upload: `-01`/`-02` ordering, size limit (a case merges to 11 MB), production switch-over | Console team answers | Console team |
| A1 | History of STP rule changes (parked 29/09) | Un-park when needed for production | Owner |
| — | Switch #2 on or off | After the rehearsal | Ulink |

## Later — needs data first

| ID | Item | Needs |
|---|---|---|
| D1 | Accuracy report: how often each AI decision is corrected, per confidence band | B5 running for a while |
| D2 | STP rule on AI confidence | D1 |

## Scaling up (see DESIGN.md §7)

| ID | Item | Trigger | Size |
|---|---|---|---|
| S1 | Jobs as separate workers (per-job cron or a queue) instead of one sequential orchestrator | Pipeline run takes longer than its interval | M |
| S2 | Parallel LLM calls with a concurrency cap; more LLM capacity | LLM time per case is the bottleneck | M |
| S3 | Roles (CSR / Ops / JD3) with per-action permissions | B5 decided | M |
| S4 | Second claim route (another claim type or insurer): route row, schema, checklist, IAS mapping; remove the hard-coded route in console-upload | A new product to automate | L |
| S5 | Multi-currency (currency from the documents + exchange rate) | Foreign-currency claims | M |
| S6 | Object storage behind the storage adapter | B7 decided | M |
| S7 | Monitoring: alert on failed pipeline steps, stuck statuses, queue age | Production go-live | M |
