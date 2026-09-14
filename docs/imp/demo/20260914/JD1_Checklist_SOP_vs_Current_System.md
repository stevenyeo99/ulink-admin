# JD1 Checklist: SOP vs Current System

Source SOP: `JD1_Claim_Document_Checking_and_Member_Verification_SOP V1.docx` (this folder).
Current system: `ulink-admin/src/ulink-api/modules/{document-checking,member-verification,claim-recognition,pipeline}`.

Status legend: ✅ Done · ⚠️ Partial · ❌ Not implemented

Ordered by implementation priority (top = do first). Each item has a checkbox to track work.

---

## 1. Signature & Declaration (SOP §10) — ❌

- [ ] Check `documents_present.has_customer_signature` is `true` before passing JD1 (field lives on the base extraction schema, `20260822090000-add-claim-recognition.js` — this is the claim form's own signature, unrelated to `delegation_letter`, see item 9 below).
- [ ] Check declaration/consent checkbox or field is present.
- [ ] Add `MISSING_SIGNATURE` / `MISSING_DECLARATION` to `document-checking/checklist.js` `ISSUES` + `EVALUATORS`.
- [ ] Confirm canned-response wording exists for these (business sign-off if not).
- [ ] Authorized-signer / relationship check (SOP §10's third bullet: "where an authorized person signs on behalf of the claimant, supporting authority/relationship should be checked") has no evaluator today — do not confuse with `delegation_letter` (that's a §9 bank-payee mechanism, see item 9).

**Why first:** zero coverage today, small self-contained addition to an existing file (`checklist.js`), no new module needed.

---

## 2. Mandatory E-Claim Field Completeness (SOP §4) — ⚠️

Only diagnosis (`checkIncompleteClaimForm`) is gated today. SOP lists 22 mandatory fields across 6 sections (Submission Info, Policy & Member Info, Claim & Treatment Info, Bank Info, Declaration & Signature).

- [ ] Decide: one generic "required fields present" evaluator over `extractedFields`, or per-field evaluators (mirrors existing style in `checklist.js`).
- [ ] Case Number, Product Type, Policy Number/Risk Name, Company Name — currently only *used* (e.g. policy match), never checked for *presence* as a standalone completeness gate.
- [ ] Claimant Name, Is Claim for Child, DOB, NRC/Passport, Phone, Email — same.
- [ ] Claim Benefit Type, Type of Patient, Appointment/Visited Date, Hospital/Clinic Name — same.
- [ ] Cross-check against what `member-verification` already treats as hard/soft — don't duplicate gating logic, just add the "is it present at all" check here.

**Why second:** largest gap by field count, but mechanical — same pattern as existing evaluators, no new data source.

---

## 3. Cross-Document Consistency — re-enable disabled checks (SOP §8) — ⚠️

`identity_consistency.patient_name_consistent` and `.medical_record_provider_consistent` are **extracted but deliberately disabled** in `checklist.js` (`checkIncorrectPatientDetails`, `checkIncorrectMedicalReport` — defined, not in `EVALUATORS`). Disabled 2026-08-22 per in-code comment: too many false positives on known-complete samples.

- [ ] Re-test `checkIncorrectPatientDetails` / `checkIncorrectMedicalReport` against current sample set (`docs/samples/20260820/...`) — false-positive rate may have changed since extraction prompt (`synthesize.md`) was last tuned.
- [ ] If still unreliable: identify what's causing false positives (script/transliteration handling in the LLM judgment?) before re-enabling.
- [ ] Treatment date consistency across Claim Form ↔ Medical Record ↔ Invoice — **no evaluator exists at all**, not even disabled. Needs new extraction/comparison logic (`medical_record.date` vs `medical.appointment_date` vs invoice date — invoice date isn't currently in `invoices.items` schema, check `synthesize.md`).
- [ ] ~~Hospital/Clinic name consistency~~ — **correction:** already covered, not a gap. Verified `medical_record_provider_consistent` (`synthesize.md` §54-56) compares `medical.doctor_name`/`hospital_or_clinic_name` against `medical_record.doctor_name`/`hospital_or_clinic_name` together — same disabled evaluator as patient name above, no separate work needed.

**Why third:** two of three sub-checks already built and just need validation + flip-on; the third (treatment date) needs new work.

---

## 4. Member Active Status — explicit flag (SOP §6.1) — ⚠️

Currently proxied entirely through `checkCoverageActive` (treatment date within `EFF_DATE`/`TERM_DATE` range). SOP separately calls out checking an explicit active-status flag in IAS/member census.

- [ ] Check `member-verification/iasClient.js` — does the IAS response carry a status field (e.g. `MBR_STATUS`) not currently read?
- [ ] If yes, add as a hard check in `member-verification/checks.js` alongside `coverageActive`.
- [ ] If no such field exists in IAS, confirm with business whether coverage-date range is accepted as equivalent — document the decision here.

**Why fourth:** might be a one-field addition to an existing IAS response read, or might be a non-issue (already effectively covered) — cheap to investigate first.

---

## 5. Treatment Date vs Submission Date (SOP §6.6) — ❌

- [ ] Confirm `claim.date_submitted` (or email received date) is extracted/available — check `synthesize.md` schema.
- [ ] Define "permitted submission period" — need the actual policy/product rule (days-from-treatment limit). Not in SOP doc itself; check with business or existing policy config.
- [ ] Add as a new check in `member-verification/checks.js`, following `checkCoverageActive`'s null-safe pattern.
- [ ] Decide outcome: hard block (`MEMBER_REVIEW_REQUIRED`) or soft flag for JD2 — SOP says "flag exceptions for assessment," suggesting soft/informational, not a hard gate like coverage/bank/DOB.

**Why fifth:** straightforward date comparison once the permitted-period rule is known — the rule itself is the blocker, not the code.

---

## 6. Treatment Type vs Eligible Benefit (SOP §6.4) — ⚠️

**Update: data source confirmed, this is cheaper than its position suggests — a re-prioritization candidate.** The benefit-eligibility data already exists on the Case: `member-verification/service.js:91` writes `iasMemberInfoResponse: outcome.iasResponse` from the *same* IAS member-info call `checks.js` already uses for the coverage-date check (§6.2/item-already-solid). `ias-claim-preparation/benefitPicker.js`'s `uniqueBenefitCandidates()` already flattens `iasMemberInfoResponse.memberPlans[0].coverageLimits[].benefits[]` into `{type, typeDesc, head, headDesc}` — it's just currently only consumed downstream (claim submission, picking the exact benefit head per voucher via an LLM call, `benefit-pick.md`).

JD1's need is coarser than that: not "which exact head," just "is this treatment type covered at all" — pure Tier-2 deterministic set-membership, **no LLM call needed for the JD1 gate**.

- [ ] Reuse `uniqueBenefitCandidates(memberPlansRaw)` (or extract it to a shared location — it's currently private to `ias-claim-preparation`) from `member-verification/checks.js`.
- [ ] Add comparison: does `claim.claim_benefit_type` / `type_of_patient` match any candidate's `type`/`typeDesc`? No new IAS call, no new LLM call.
- [ ] New reasonCode (e.g. `BENEFIT_NOT_ELIGIBLE`) in `member-verification/checks.js`, output as flag for JD2 (SOP says JD1 doesn't reject, just checks/provides for assessment).

**Why sixth (but reconsider):** originally scoped as "highest unknown" — that unknown is now resolved. This is now cheaper than items 4/5, which still have open policy-rule questions. Worth moving up.

---

## 7. Diagnosis vs Policy Exclusion (SOP §6.3) — ❌

**Update: exclusion list located, confirmed prose-based (Tier-4 judgment, not a code lookup) — real ingestion work, not a quick flip like item 6.** Checked both docs in `docs/imp/demo/20260914/samples/`:

- `AYAHealth_Special Conditions and Benefit Clarifications...xlsx` — **not an exclusion list.** Per-policyholder overrides (e.g. HEINEKEN's vaccination-campaign restriction, named-employee maternity waivers, Kachin-staff claim-window extension) and general benefit-interpretation opinions (chronic condition, pre-existing, optical). Relevant as an *override* layer (see below), not the base exclusion source.
- `AYA SOMPO...Policy Wording_English.pdf` — **this is it.** Section 6 "General Exclusions," 41 clauses (6.1–6.41), plus per-section "Specific Exclusions" scattered through Sections 1–4 (Maternity, Thailand Zone, Optical, Dental, Personal Accident). All written as free-text legal clauses (e.g. *"self-inflicted Injury"*, *"Chronic or end-stage kidney failure which... will require... dialysis"*, *"Cosmetic surgery... unless required as a direct result of an Accident"*) — not ICD-10 codes. `diagnosisPicker.js`'s code output doesn't map onto this directly.

Three real complications found, not just "list exists now, ship it":
- [ ] **Prose, not codes** — confirms Tier-4 (free-text diagnosis vs free-text clause), same reasoning shape as identity-consistency judgments, not a set-membership check like item 6.
- [ ] **Not binary** — some clauses are sub-limits, not hard excludes (6.19: HIV/AIDS capped at 7,500,000 MMK, not excluded outright). Output needs excluded / capped / needs-review, not true/false.
- [ ] **Two layers** — product-level base exclusions (the PDF, per insurer/product via `ulink_claim_routes`) + policyholder-level overrides (the xlsx, can permit what the base wording excludes — e.g. TOB's group policy explicitly allows outpatient psychiatric treatment that 6.35 otherwise excludes). Checking the PDF alone will false-flag correctly-covered claims for policyholders with an override on file.
- [ ] Each additional insurer/product route will have its **own** policy wording doc with its own exclusion clauses — this is a recurring ingestion task per product, not a one-time PDF read.

**Recommended approach** (reuses the existing ICD-10 RAG pattern, doesn't invent a new one): digitize Section 6 + specific exclusions into a DB table scoped by route/product; vector-retrieve top-K candidate clauses per claim's diagnosis/treatment text (same shape as `icd10/lookup.js`); one narrow LLM call judges match against the retrieved candidates (same shape as `diagnosisPicker.js`); check the policyholder-override table after, surface both signals to JD2 (SOP: flag only, never decide).

**Why seventh:** genuinely new work now that the source is confirmed — a new table, an ingestion step, and a new narrow LLM call — not a quick flip. Correctly stays lower priority for Module 1, now for a documented reason instead of an unknown one.

---

## 8. Available Benefit Balance (SOP §6.5) — ❌

- [ ] Requires live balance data from IAS (or wherever balances are tracked) per member/plan/benefit-type.
- [ ] Check if `iasClient.js` has an existing endpoint for this, or if it needs a new IAS integration.
- [ ] Not a pass/fail check — SOP says "provide it for assessment" (informational field for JD2, not a JD1 gate).

**Why last:** most likely needs a new IAS integration point — highest unknown, lowest urgency (informational only, not a gate).

---

## 9. Reference Fields Not Extracted (SOP §4 footnote) — ❌

SOP: *"Reference fields to review when available: Date Submitted, Submission Channel, Doctor Name and Treatment Outside Myanmar."* `date_submitted` and `doctor_name` are already in the extraction schema (`synthesize.md`) and used elsewhere (item 5, item 3). `Submission Channel` and `Treatment Outside Myanmar` are **not in the schema at all** — not extracted, not checked, not surfaced anywhere.

- [ ] Confirm with business whether these two are actually needed for JD1 (e.g. does "treatment outside Myanmar" change eligibility/routing?) or were just listed as reference-only in the SOP.
- [ ] If needed: add to `claim-recognition/prompts/synthesize.md` extraction schema, then decide informational-only vs. a new check.

**Why ninth:** explicitly named in the SOP but the business need is unconfirmed — cheap to ask, don't build extraction speculatively.

---

## 10. Explicit "Ready for JD2 Handover" Flag (SOP §13) — ❌

SOP's final checklist has this as its own checkbox, separate from the 12 individual Yes/No items. Today readiness is only implicit (no open `ISSUES` on the case) — no dedicated stored flag/timestamp. `pipeline/service.js` only tracks run-execution status (`PENDING/RUNNING/DONE/FAILED/COMPLETED_WITH_ERRORS`), not a business-level "cleared for JD2" state.

- [ ] Confirm with business whether implicit (no open issues = ready) is sufficient, or JD2 handover needs an explicit stored flag/timestamp for audit/reporting.
- [ ] If explicit: add once the rest of this checklist's checks exist — this is a rollup, not new logic.

**Why last:** lowest urgency — likely fine as-is, and it's a rollup of every other item on this list, so it can't usefully be built before them.

---

## Reference: already solid, no action needed

- §5 Claim Form Verification (correct insurer form) — `claim-recognition` route decision. Caveat: "form applicable to relevant product/policy" is moot today — the system has exactly one enabled route (Day 1, per `routeCatalog.js`); revisit when a second route/product is added.
- §6.2 Treatment Date vs Coverage Date — `checkCoverageActive`.
- §7 Medical Document Verification (presence/legibility) — `checkNoMedicalReport`, `checkIncompleteMedicalReport`, `checkUnclearVoucher`.
- §8 Amount consistency — `checkVoucherAmountMismatch`.
- §9 Bank Information — `checkMissingBankInfo` + member-verification hard checks (bank name/account name/number vs IAS). Payee-mismatch sub-case ("account holder name differs from claimant") handled by `checkDelegationLetterRequired`, which is **live** (in `EVALUATORS`) but deliberately loosened: it only checks `delegation_letter.present === true`, not `identity_consistency.delegation_letter_authorizes_payee === true` — so it currently accepts *any* delegation letter, not necessarily one naming the actual payee on record. Code comment (`checklist.js`, `20260824100000-add-delegation-letter.js`) flags this as a fraud-prevention gap to close before relying on it for real claims — cheap flip-on (add one condition), needs a decision on how tolerant to be of "letter present but LLM says it doesn't authorize this payee."
- §11 Missing/Inconsistent Info handling pattern — `ISSUES` + `MEMBER_REVIEW_REQUIRED` reasonCodes.
- §14 JD1 doesn't auto-decide — respected throughout, system only flags/escalates.
