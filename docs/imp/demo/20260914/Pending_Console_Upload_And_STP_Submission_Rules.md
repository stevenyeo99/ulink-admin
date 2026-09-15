# Pending: Console Document Upload + Barcode, and STP Submission Validation Flags

**Status: PENDING — not implemented.** Deliberately deferred: build only after
document-checking (JD1) is verified against real cases — current work in progress is
`docs/imp/demo/20260914/samples/1` through `/5` (see `JD1_Checklist_SOP_vs_Current_System.md`).
Revisit this file once that verification is signed off.

---

## 1. New job: document upload to console + barcode on clean-case submission

**What:** when a case is "clean" (passes document-checking), a new job should (a) upload
the case's documents to `ulink-console`, (b) generate a barcode, (c) apply/attach that
barcode as part of submitting the claim.

**Already sketched:** `docs/imp/demo/20260914/samples/console proto/demo_barcode_logic.md`
has a draft barcode format — `VS + YY(base36) + MM(base36) + DD(base36) + "1" + 4 random
digits` (e.g. `VSQ9E1XXXX`), explicitly generated **at submission time, not upload time**.
Reuse that format rather than re-deriving one.

**Existing pipeline anchor:** `ias-claim-creation` (`modules/ias-claim-creation/service.js`)
is the job that currently calls the real IAS `CL_CLAIM_API` once a case reaches
`CLAIM_PAYLOAD_PREPARED` — "submit claim api" most likely refers to this step, but needs
confirming, not assuming.

**Confirmed 2026-09-15:** once the console upload job exists, the generated barcode gets
included in the `CL_CLAIM_API` payload (`payloadBuilder.js` — no such field exists there
today, needs adding once the job that generates the barcode exists).

**Still open before implementation:**
- Is "document upload to console" a new standalone job/status step, or folded into the
  existing `ias-claim-creation` job? (Sequencing matters: the barcode must exist before
  `payloadBuilder.js` builds the payload, so whichever job generates it has to run first.)
- Exact payload field name/shape for the barcode on `CL_CLAIM_API` — not in the real sample
  (`docs/imp/day1/IAS/ias_claim_submission_api.json`) today, so this is a new field IAS needs
  to confirm it accepts, not an existing one being populated.
- "if clean case" — confirm this means `Case.documentCheckResult.passed === true` (zero
  JD1 document-checking issues). `member-verification` already gates upstream of that in
  the pipeline, so it should already be implied, but worth confirming explicitly.

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

**Still blocking:** the actual threshold amount was not specified — "below the amount" has
no number attached yet. This can't be implemented as more than a placeholder until that
figure is confirmed by business.
