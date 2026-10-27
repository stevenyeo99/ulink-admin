# SYSTEM_5 PRD: the hospital name passes when the medical record and the invoices agree

Owner: Steven Yeo. Written: 2026-10-27. Status: approved by the owner on 2026-10-27.
Source: 4th demo feedback, "Claim form & medical & invoice hospital/clinic name". Sample: AYA-CL-26043766.

## 1. Background

The document check `HOSPITAL_NAME_INCONSISTENT` compares the hospital on the claim form with the hospital on the medical record. If they differ, the case stops, and the customer is asked for an explanation.

The customer writes the claim form. The medical record and the invoice come from the hospital. In AYA-CL-26043766, the claim form named another hospital, but the medical record and the invoice came from the same hospital. ULINK staff pass such a claim.

The AI does not read the hospital name on the invoices. That field was removed on 2026-08-22 because the AI made up names (`20260822200000-simplify-invoice-items.js`). The IAS claim takes `ProviderName` from the claim form.

## 2. Requirements

1. The AI reads the hospital or clinic name on each voucher again (`invoices.items[].hospital_or_clinic_name`). It reads only the name printed on that voucher, from its letterhead or stamp. Otherwise the value is null. The AI never copies the name from the claim form or the medical record. When two reads of one voucher give different names, both are kept (`hospital_names_read`).
2. The check compares names by meaning (AI, `entityMatch`), one call for each different name. A name that is the same once capitals and spaces are ignored needs no call. Pharmacy and optical receipts are not compared, because they can come from another shop (owner, 2026-10-27). If every AI answer is too unsure to use, today's rule applies.

   | Case | Result |
   |---|---|
   | The medical record and every voucher with a name agree | Pass. The reason names the hospital and says that the medical record name is used for IAS. If the claim form names another hospital, the reason also gives that name |
   | The medical record and a voucher disagree | Fail, as today, naming the voucher |
   | No voucher has a hospital name | Today's rule: the claim form against the medical record |
   | The medical record has no hospital name | The claim form against the vouchers |

3. The IAS claim takes `ProviderName` from the medical record. If the medical record has no hospital name, it takes the claim form's.
4. The same backend logic runs in the email flow and the API flow. The switch for the check on the AI checklist page stays as it is.

## 3. New settings and data

One migration adds `hospital_or_clinic_name` to each voucher in the claim schema of the route `ayas_member_claim`. No new table or `.env` value.

## 4. Risks

1. The invoice hospital name was removed once because the AI made up names. After phase A, run AYA-CL-26043766 and a few other samples, and make sure that each invoice name is real.
2. One more AI call for each different hospital name read on the vouchers.

## 5. Implementation plan

| Phase | Content | Status |
|---|---|---|
| A. Backend | Migration, extraction prompt, voucher merge, hospital rule, IAS `ProviderName`, AI checklist card, tests | Done, awaiting review (2026-10-27). Migration run on dev |
| B. Docs | `OPERATIONS.md`, `CLAIM_FLOW_END_TO_END.md`, the SYSTEM_5 PRD check list, the change log | Done, awaiting review (2026-10-27) |
