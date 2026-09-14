# Demo Clarifications Needed

Consolidated list of everything in the JD1 SOP gap analysis (`JD1_Checklist_SOP_vs_Current_System.md`) that is blocked on a business/demo answer, not on engineering work. Each of these has code that's either trivial or already written, waiting on one decision.

---

## 1. Signature & Declaration field shape (SOP §10)

`documents_present.has_customer_signature` already exists and is extracted (base schema). Declaration/consent itself is **not extracted at all** — no field exists yet for it.

**Need:** what does the declaration/consent actually look like on the claim form (a checkbox? a signed statement? a separate section)? Determines the extraction schema addition and what `checklist.js` should check for.

**Also SOP §10's third bullet:** "where an authorized person signs on behalf of the claimant, supporting authority/relationship should be checked" — no evaluator exists for this at all today. Do not confuse with `delegation_letter` (that's a separate §9 bank-payee mechanism, already implemented).

---

## 2. Permitted claim-submission period (SOP §6.6)

`claim.date_submitted` is already extracted. The check itself (`date_submitted` vs treatment date, flag if the gap exceeds a limit) is a one-line date comparison once the limit is known.

**Need:** the actual number of days allowed between treatment and submission. Not stated in the SOP document itself — likely a per-product/policy rule. Also need to confirm: is this a hard block (`MEMBER_REVIEW_REQUIRED`) or a soft flag for JD2 to review? SOP wording ("flag exceptions for assessment") suggests soft/informational, not a hard gate like coverage/bank/DOB — but worth confirming explicitly.

---

## 3. Submission Channel / Treatment Outside Myanmar — actually needed? (SOP §4 footnote)

SOP: *"Reference fields to review when available: Date Submitted, Submission Channel, Doctor Name and Treatment Outside Myanmar."* Two of these four are already extracted and used elsewhere (`date_submitted`, `doctor_name`). The other two — **Submission Channel** and **Treatment Outside Myanmar** — are not in the extraction schema at all.

**Need:** confirm whether either of these actually changes eligibility or routing (e.g. does treatment outside Myanmar affect coverage?), or whether the SOP lists them purely as reference/informational fields with no downstream check. Cheap to add extraction + a check if needed — not worth building speculatively if they're informational-only.

---

Everything else in the JD1 gap analysis is either done or has a clear, unblocked engineering path — see `JD1_Checklist_SOP_vs_Current_System.md` for the full picture.
