# Pending: Console Document Upload + Barcode, and STP Submission Validation Flags

Item 1 below is **done** (built 2026-09-15, ahead of this doc's original "defer until JD1
samples 1-5 are verified" plan — that verification thread never reached a signed-off
conclusion before item 1 was greenlit and built; noted here rather than silently dropped).
Item 2 is still genuinely pending.

---

## 1. Console upload job + barcode — DONE (2026-09-15)

**What was built**, differs from this doc's original open questions in a few places (see
below) — treat this section as the actual spec, not the "what/still open" draft above it:

- **New standalone job**, not folded into `ias-claim-creation`: `modules/console-upload/service.js`,
  registered as its own pipeline stage (`POST /api/jobs/console-upload/run`, dev preview at
  `POST /api/dev/console-upload/{caseId}/preview`). Introduces a new status,
  `DOCUMENTS_UPLOADED`, between `document-checking`'s `MEMBER_VERIFIED` and
  `ias-claim-preparation` (which now reads `DOCUMENTS_UPLOADED` instead of `MEMBER_VERIFIED`).
- **Gate**: `Case.currentStatus === 'MEMBER_VERIFIED'` **and**
  `Case.recognizedType === 'ayas_member_claim'` — narrower than this doc's original "any
  clean case" framing: scoped explicitly to the AYAS reimbursement route, not every case
  that passes document-checking.
- **What gets copied**: every inbound attachment on the case
  (`modules/shared/gatherAttachments.js`, extracted from `claim-recognition` so both share
  the exact same query). **Copy, not move** — the original stays in `STORAGE_ROOT`
  untouched, for reprocessing. Plain files, no zip (no zip library in this project's
  dependencies; a shared ops folder is more useful browsable than something that needs
  extracting).
- **Destination**: a new, separate root — `CONSOLE_UPLOAD_ROOT` (`.env`:
  `/mnt/c/client/ulink/console`) — not `STORAGE_ROOT`, which is this app's own private
  attachment store.
- **Folder naming** (not specified anywhere before this build): `yyyy/MM/dd/{ddMMyyyy}{claimantName}-AYAS-{caseId}/`.
  The date is **when this job actually runs** (`new Date()` at upload time) — not the
  original email-receipt date, not the OCR-extracted `claim.date_submitted`.
- **Barcode**: format reused verbatim from `docs/imp/demo/20260914/samples/console proto/demo_barcode_logic.md`
  (`VS` + yy + mm(base36) + dd(base36) + `"1"` + 4 random digits), generated at the same
  `new Date()` as the folder date so the two can never disagree across a midnight boundary.
  Stored on `Case.consoleBarcode`.
- **Where the barcode gets applied — this doc's original guess was wrong**: it does NOT go
  through `ias-claim-creation`. It's wired into `ias-claim-preparation/payloadBuilder.js`'s
  `CL_CLAIM_API` payload as a top-level `barcode` field, since console-upload now runs
  before `ias-claim-preparation` in the pipeline (`Case.consoleBarcode` is guaranteed to
  exist by the time that job builds the payload).
- **Payload field name**: literal `"barcode"` — still **provisional**, not IAS-confirmed.
  You're having IAS dev add support for it server-side; the key name may need to change
  once they confirm what they actually accept.

**Migration**: `ulink_cases` gained `console_upload_result` (JSONB — folder + file list) and
`console_barcode` (TEXT).

---

## 2. STP claim: conditional `isValidation`/`isCSR` flags by claimed-amount threshold

**What:** when the total presented/claimed amount is below some threshold, set
`isValidation=Y` and `isCSR=Y` on the `CL_CLAIM_API` submission payload instead of the
current fixed values.

**Current state:** `modules/ias-claim-preparation/payloadBuilder.js:86-87` hardcodes both
to `'N'` for every case — and that was a *deliberate correction*, not an oversight (see the
block comment at lines 12-16): an earlier assumption that `isValidation` should be `'Y'`
was found to be wrong and fixed to `'N'`. A new amount-based conditional rule must not
silently regress that earlier fix — needs to be explicit about exactly which cases get `Y`
vs `N`, with the reasoning recorded the same way the existing comment does.

**Confirmed 2026-09-15:** the comparison is against the claim payload's **total** `PresentedAmt`
(sum across all `Items[]`, i.e. the same aggregate as `claim.total_claim_amount` / the summed
voucher subtotals `document-checking/checklist.js`'s `checkVoucherAmountMismatch` already
computes) — not a per-line/per-item comparison.

**Built 2026-09-15, with a DEMO threshold, not a confirmed production one:**
- New table `ulink_stp_limits` (`route_key`, `currency`, `amount_limit`), seeded with one row:
  `ayas_member_claim` / `MMK` / **50,000** — chosen by analyzing the existing complete
  sample cases to get a believable STP/non-STP mix for a demo (day1/complete/1=23,000,
  20260826/complete/2=32,500 → STP; day1/complete/2=54,690, 20260826/complete/1=145,000 →
  non-STP), not from any business-confirmed limit. **Update this row's `amount_limit` once
  the real figure is confirmed** — no code change needed, just the seeded value.
- New `Case.isStp` (boolean, nullable — null means "not evaluated yet"), computed by
  `modules/ias-claim-preparation/stpEligibility.js` from the summed line `PresentedAmt`
  against the matching `ulink_stp_limits` row. No matching route/currency row → defaults to
  `false` (falls back to the existing manual-review path), never guessed `true`.
- `payloadBuilder.js`'s `isValidation`/`isCSR` are now `"Y"`/`"Y"` when `Case.isStp` is true,
  `"N"`/`"N"` otherwise — the earlier `'N'`/`'N'` fix (see above) is preserved as the
  non-STP default, not reverted; `"Y"` only appears for cases that actually qualify.
