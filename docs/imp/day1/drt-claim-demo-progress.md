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
| 2 | Document checking and member verification | ⚠️ In progress — extraction data ready, comparison logic + IAS lookup not yet built |
| 3 | Identify missing document | ❌ Not started (blocked on 2) |
| 4 | Draft email requesting missing document | ❌ Not started (blocked on 3) |
| 5 | Send to Ulink's email | ❌ Not started (blocked on 4; SMTP send is a stub, see below) |
| 6 | Complete case → create claim number in iAS | ❌ Not started (independent of 3-5) |

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

## 2. Document checking and member verification — ⚠️ In progress

**Not yet built**: the code that consumes `extracted_fields` to actually flag
issues, and the IAS member lookup.

### Document checking (design settled, not implemented)
Maps directly onto `extracted_fields` — no new extraction needed, this is
comparison logic in code:

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

### Member verification (design settled, not implemented)
Reference: `ulink-is-ai/src/services/iasService.js::postMemberInfoByPolicy` +
`docs/imp/day1/IAS/ias_get_member_information_response_v2.json` (sample response).

- **Lookup**: `POST {IAS_URL}{GET_MEMBER_INFO_API}` with
  `{ memberNrc: claimant.claimant_nrc_passport, meplEffDate: claim.accident_date }`
  (formatted `MMDDYYYY`). No new OCR fields needed — both already extracted.
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

## 5. Send to Ulink's email — ❌ Not started

**Blocker**: `channels/imapSmtpChannel.js::sendReply()` is a deliberate stub
(throws `not implemented yet`) — built that way earlier specifically anticipating
this step. Confirmed direction: drafted emails go to Ulink's own inbox for
review, not directly to the claimant/sender — worth re-confirming before
building the send path.

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
