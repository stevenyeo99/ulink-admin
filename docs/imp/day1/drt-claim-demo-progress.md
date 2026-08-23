# DRT Claim Demo — Progress Status

Living tracker for the DRT demo's 6-step target workflow. Update this file at the
end of each development session — mark steps done/in-progress, note new files,
and record any limitation discovered along the way. Companion to
`drt-claim-demo-implementation-plan.md` (the original block-by-block plan).

## Target workflow

```
1. Email submission recognition
2. Document checking and member verification
3. Identify missing document
4. Draft email and request for the missing document
5. Send to Ulink's email
6. For complete case, create claim number in iAS
```

Steps 2 → 3 → 4 → 5 are a dependency chain (each needs the previous step's
output). Step 6 branches off independently for cases that pass step 2 cleanly.

---

## Status

| # | Step | Status |
|---|---|---|
| 1 | Email submission recognition | ✅ Done — verified end-to-end on real sample case |
| 2 | Document checking and member verification | ✅ Done — `document-checking` + `member-verification` jobs built, verified against real samples (see `jobs-registry.md`) |
| 3 | Identify missing document | ✅ Done — `document-checking/checklist.js`'s `issues[]` output |
| 4 | Draft email requesting missing document | ✅ Done — `modules/email-sender/templates.js` |
| 5 | Send to Ulink's email | ✅ Done — `email-sender` job + `channels/imapSmtpChannel.js::sendReply` (no longer a stub); confirmed direction changed since this was written, see note in section 5 below |
| 6 | Complete case → create claim number in iAS | ❌ Not started — next up (`ias-claim-creation` in `jobs-registry.md`) |

---

## 1. Email submission recognition — ✅ Done

**Pipeline**: `email-intake` (Block 1) → `claim-recognition` (Block 2).

- `modules/email-intake/` — IMAP fetch (via `channels/imapSmtpChannel.js`), thread/case
  matching, attachment storage. Sets `Case.currentStatus = READY_FOR_DOCUMENT_READING`.
- `modules/claim-recognition/` — for each case: rasterize every attachment
  (`rasterize.js`, `pdftoppm` @ 100 DPI), one vision LLM call per page
  (`llmClient.js::transcribePage`, `reasoning_effort:'none'` — required, this model
  hangs on hard content otherwise), one text-only synthesis call
  (`llmClient.js::synthesizeJson`) against the DB-driven route catalog
  (`ulink_claim_routes`), `ajv`-validated against the route's schema, persisted to
  `Case.recognizedType`/`extractedFields`/`currentStatus`
  (`RECOGNIZED`/`NOT_RECOGNIZED`/`MANUAL_REVIEW`).
- Endpoints: `POST /api/jobs/claim-recognition/run` (real, persists),
  `POST /api/dev/claim-recognition/:caseId/preview` (dry run, zero persistence — for
  manual QA).

**`extracted_fields` shape** (route `ayas_member_claim`): `policy`, `claimant`,
`claim`, `medical`, `bank` (typed-field sourced, high accuracy), `documents_present`
flags, `medical_record` (`present`/`legible`/`patient_name`/`doctor_name`/
`hospital_or_clinic_name`/`date`), `invoice` (same shape +
`has_itemized_breakdown`/`invoice_amount`/`line_items`). Every field is `required`
in the schema — a response missing a key fails `ajv` validation rather than
silently persisting incomplete data.

**Known limitations** (accepted, not bugs):
- Handwritten Burmese-script names on the voucher/medical record are unreliable —
  correctly returned as `null` rather than guessed.
- Handwritten dates can have single-digit misreads (e.g. month digit).
- `invoice.line_items` per-line prices carry real uncertainty even on a structured
  table — `invoice.invoice_amount` is the only value treated as authoritative.
- Format-agnostic by design (prompts ask for meaning, not a fixed template), but
  only validated against one clinic's document layout so far (both sample cases
  are the same clinic/template) — untested against genuinely different formats.

---

## 2. Document checking and member verification — ✅ Done

Built as two separate jobs (`modules/document-checking/`, `modules/member-verification/`),
per `jobs-registry.md` — see that file for endpoints/status-chain detail. Below is the
design as originally settled; the implementation followed it, with two corrections found
along the way: `meplEffDate` is `YYYYMMDD` (not `MMDDYYYY` as stated below), and IAS's own
response dates (`DOB`/`EFF_DATE`/`EXP_DATE`/`TERM_DATE`/`REINST_DATE`) are `MMDDYYYY`.

### Document checking (implemented — `modules/document-checking/checklist.js`)
Maps directly onto `extracted_fields` — no new extraction needed, this is
comparison logic in code. The extraction schema evolved since this table was written
(`invoice` → `invoices.items[]`, an array — a claim can have more than one voucher), and a
few checks (incorrect patient details / incorrect medical report) are deliberately disabled
for now — see `checklist.js`'s own header comment for the current, authoritative list:

| Checklist item | Check |
|---|---|
| Missing voucher(s) | `invoice.present === false` |
| No Medical Report(s) | `medical_record.present === false` |
| Unclear voucher(s) | `invoice.legible === false` |
| Unclear/incomplete medical report(s) | `medical_record.legible === false` |
| Missing itemized pharmacy breakdown | `invoice.has_itemized_breakdown === false` |
| Amount inconsistent with claimed amount | `invoice.invoice_amount` vs `claim.total_claim_amount` |
| Incorrect voucher(s) | `invoice.patient_name`/`hospital_or_clinic_name` vs form |
| Incorrect medical report(s) / patient details | `medical_record.patient_name`/`doctor_name`/`hospital_or_clinic_name` vs form |
| Incomplete medical claims form (Section B) | `medical.detail_of_illness_injury`/`full_description_of_treatment` non-null |
| Missing/incorrect bank information | `bank.*` non-null / vs IAS member record (needs member verification) |

### Member verification (implemented — `modules/member-verification/`)
Reference: `ulink-is-ai/src/services/iasService.js::postMemberInfoByPolicy` (HTTP mechanics
only, not business logic) + the real sample req/res pairs in
`docs/imp/day1/samples/*/IAS Member Info API Req-Res.json` and
`docs/imp/day1/samples/no_member_exist_case.json` (the not-found shape).

- **Lookup**: `POST {IAS_URL}{GET_MEMBER_INFO_API}` with
  `{ memberNrc: claimant.claimant_nrc_passport, meplEffDate: claim.accident_date }`,
  **`YYYYMMDD`** (verified against real samples — corrects this doc's earlier `MMDDYYYY`
  note). No new OCR fields needed — both already extracted. Coverage-active check uses
  `memberPlans[0]`'s own `EFF_DATE`/`EXP_DATE`, with `REINST_DATE`/`TERM_DATE` overriding
  them when set (`NVL(REINST_DATE, EFF_DATE)` .. `NVL(TERM_DATE, EXP_DATE)`).
- **Comparison** (code-level, normalized string/date equality — no LLM):

  | OCR field | IAS field | Tier |
  |---|---|---|
  | (lookup key) | `payload.member.ID_CARD_NO`/`MBR_REF_NO` | Hard (implied by a successful lookup) |
  | `policy.policy_no` | `payload.policies[0].POCY_REF_NO` | Hard |
  | — | `policies[0].EFF_DATE`/`EXP_DATE` vs `claim.accident_date` | Hard (policy active on incident date) |
  | `claimant.claimant_dob` | `payload.member.DOB` | Hard |
  | `bank.bank_name` | `payload.member.BANK_NAME` | Hard — resolves "Incorrect bank details" |
  | `bank.bank_account_name` | `payload.member.CL_PAY_ACCT_NAME` | Hard |
  | `bank.bank_account_number` | `payload.member.CL_PAY_ACCT_NO` | Hard |
  | `claimant.claimant_name` | `payload.member.MBR_LAST_NAME` | Soft (name formatting varies) |
  | `claimant.phone_number` | `payload.member.MOBILE_NO` | Soft |
  | `claimant.email_address` | `payload.member.EMAIL` | Soft |

- **`.env` already configured**: `IAS_URL`, `GET_MEMBER_INFO_API`,
  `CL_PRE_APP_CLAIM_API`, `CL_CLAIM_API`, `CL_CLAIM_STATUS_API`,
  `CL_DOWNLOAD_FILE_API`.

---

## 3. Identify missing document — ❌ Not started

Aggregation of step 2's failed checks into a list (e.g.
`["No Medical Report(s)", "Incorrect bank details"]`) + a `Case` status
transition (plan's suggested vocabulary: `INCOMPLETE` vs `READY_FOR_CLAIM`).

## 4. Draft email requesting missing document — ❌ Not started

Needs step 3's list as input, plus a drafting prompt/template. Plan document has
a starter template (`docs/imp/day1/drt-claim-demo-implementation-plan.md`,
Block 13).

## 5. Send to Ulink's email — ✅ Done

Built as `modules/email-sender/` — `channels/imapSmtpChannel.js::sendReply()` is
implemented (no longer the stub this section originally described). **Direction
changed from what's recorded above**: this section previously said drafted emails
go to Ulink's own inbox for review, not the claimant directly — that's
superseded. Confirmed instead (2026-08-23): replies go straight back to whoever
the case's inbound email actually came from (`EmailMessage.fromAddr` on the last
inbound message in the thread), fully automatically, no manual-approval step.
`channels/imapSmtpChannel.js`'s own comment referencing the demo plan's "Block 14:
Manual Approval Step" is the same superseded direction — not implemented.

## 6. Complete case → create claim number in iAS — ❌ Not started

Independent of 3-5. Reference: `ulink-is-ai/src/services/iasService.js::postClaimSubmission`.
Needs a new `Case` status (plan's suggested `CLAIM_CREATED`) and a claim-number
field on `Case` (not yet added to the schema).

---

## How to use this file

- Update the status table and each section's detail whenever a step's
  implementation state changes — don't let it drift from the actual code.
- Link concrete file paths as they're built, so a new session can find the
  relevant module without re-deriving the whole design from conversation history.
- Known limitations belong here, not just in conversation — they inform design
  decisions on later steps (e.g. step 2's "incorrect voucher" check already
  accounts for handwritten-name unreliability found in step 1).
