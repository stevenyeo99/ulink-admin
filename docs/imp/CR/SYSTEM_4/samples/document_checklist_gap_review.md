# Document checklist: ULINK staff checks compared with our document check

Date: 2026-10-18. Status: advice for review. No code changed.

Source: the `human_checklist.md` file in each sample folder, compared with
`src/ulink-api/modules/document-checking/checklist.js` and
`src/ulink-api/modules/claim-recognition/prompts/extract-fields.md`.

## Summary

Our document check covers the general items. It does not cover the document lists that ULINK staff use for each
claim type. Our check treats "a medical record" as one thing for every claim. The staff check a different set of
documents for inpatient, dental, vision and vaccination claims.

## Comparison per sample

| Case | Claim type | What the staff checked | Our check today |
|---|---|---|---|
| AYA-CL-26040093 | Inpatient | Discharge summary, itemized invoice per admission day, procedure or operation note, investigation reports, pre-admission consultation (if available) | One "medical report present and readable" check. Voucher present and readable. Amount match. No document kinds. No daily breakdown. |
| AYA-CL-26042304 | Inpatient | Same list as AYA-CL-26040093 | Same as AYA-CL-26040093 |
| AYA-CL-26043766 | Dental | Consultation note for each procedure with the medical book cover. Invoice with the price of each procedure. Complete. | Medical report present. Voucher present. No book cover check. No price per procedure. |
| AYA-CL-26043772 | Dental | Same list as AYA-CL-26043766. Complete. | Same as AYA-CL-26043766 |
| AYA-CL-26043792 | Vision | Eye consultation note with the medical book cover, eye power test slip, invoice with the price of each item. Complete. | The optical voucher is read (`voucher_type`). No eye test slip check. |
| AYA-CL-26043392 | Vision | Same list. The eye power test slip had no date, so the staff asked the member for a new slip. | No check for a date on the eye test slip. This case passes our check. |
| AYA-CL-26043951 | Vaccination | Doctor's recommendation note for each vaccination date, vaccination records, itemized invoice | Medical report present only. No recommendation note per date. |
| AYA-CL-26044486 | Vaccination | Same list as AYA-CL-26043951 | Same as AYA-CL-26043951 |
| AYA-CL-26041363 | Outpatient | Four supplements with amounts (Minigadine-MV 22,000, Superkids 6,000, Chewy Vitamin C 11,000, Iaminovit 17,000) sent for a coverage check | Covered. E4-10 lists each vitamin with its amount. JD3 approves. The amount goes to IAS as a manual rejection. |
| AYA-CL-26040946 | Outpatient | Montelukast 4 mg, 42,000, sent for a coverage check | Not covered. Montelukast is a medicine, not a vitamin, so E4-10 does not flag it. |

## What already matches

- The claim form is complete.
- A voucher and a medical record are present and readable.
- The voucher total agrees with the claimed amount.
- The medical record date agrees with the visit date.
- The patient name on the documents agrees with the claim form.
- The bank details are present.
- Vitamins and supplements are listed with their amounts.

## Gaps

1. Document kinds per claim type. The AI reports only that a medical record is present. It does not report which
   kinds of document are present. So the check cannot see that an inpatient claim has no discharge summary, or that
   a vision claim has no eye power test slip. This gap affects 8 of the 10 samples.
2. Itemized breakdown. Our breakdown check runs only on pharmacy vouchers, because the approved customer wording
   says "pharmacy charges". The staff require a breakdown for inpatient claims (per day), dental claims (per
   procedure), vision claims (per item) and vaccination claims (per item).
3. A date on each document. We compare only the date of the main medical record with the visit date. An eye test
   slip with no date (AYA-CL-26043392) passes. One recommendation note for two vaccination dates also passes.
4. Coverage checks for medicines that are not vitamins. The staff sent Montelukast to the coverage team. We have no
   rule for this case, and the rule must come from ULINK.

## Recommendation

Keep a list of required documents per claim type as data next to the checklist. Add one AI output per page: the
kind of document and its date. Examples of kinds are discharge summary, operation note, investigation report, eye
test slip, dental consultation, vaccination record, doctor's recommendation, medical book cover and itemized
invoice. A rule then compares the kinds found with the list for the claim type.

- A missing required document makes the case incomplete.
- A conditional item ("if surgery", "if available") becomes a review point for a person. It does not block the
  case.
- The claim type comes from "Type of Patient" on the claim form and from the IAS benefit type.
- Widen the breakdown check from pharmacy vouchers to every voucher type in the same change.

Suggested order:

1. Vision and dental. Their lists are short and clear. The samples have three complete cases (AYA-CL-26043766,
   AYA-CL-26043772, AYA-CL-26043792) and one incomplete case (AYA-CL-26043392) for the tests.
2. Vaccination.
3. Inpatient, which has the conditional items.

## Inputs needed from ULINK before a build

1. Approved customer wording for each new missing-document line. The customer email uses only approved canned text.
2. The rule for coverage checks on medicines that are not vitamins. For example, a list of medicines, or a rule
   such as "a medicine that the doctor did not prescribe for this diagnosis". Without this rule, the Montelukast
   case (AYA-CL-26040946) cannot be built.
3. The approved document list for each claim type, including outpatient claims. The outpatient samples
   show only the supplement question and no document list.
