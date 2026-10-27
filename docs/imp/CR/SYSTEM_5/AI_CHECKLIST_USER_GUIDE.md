# AI checklist: user guide

This guide is for super admins. It explains how to read the AI checklist page and how to switch a check off or on. The design is in `PRD/SYSTEM_5_PRD.md`.

## Open the page

In the console sidebar, open Admin, then AI checklist. Only a super admin can open the page.

## Read the page

The page lists every check that the system runs on a claim, in both flows (email and API). The checks run in two steps. Step 1 is the member check against IAS. Step 2 is the document check.

The checks are grouped by the paper that they look at: member and policy, claim form, vouchers, medical record, bank and payee, and what the AI read. Each check is one card with these parts:

1. The question that the check answers.
2. A tag. *Can stop the case* means that the case waits for a person or the customer is asked for documents. *Warning only* and *Information* never stop a case. *Locked on* means that the check cannot be switched off.
3. What the check does.
4. The result of a failed check. A document check shows the sentence that the customer receives.
5. What a reviewer can do on a case: mark the line passed or failed, correct a value, or nothing.
6. The switch and its last change: the person, the date and the reason.

To see only the checks that can stop a case, select *Can stop a case* at the top. To see the check codes, the line names on the case page and the checks that are off in the code, select *Show technical details*.

## Switch a check off

1. On the check's card, select *Switch off*.
2. Type the reason. The reason is required.
3. Select *Switch off* again to save.

From then on, the system does not run the check on cases. If the check is an AI comparison, the AI is not asked. On the case page, the line shows *Turned off*, with the person, the date and the reason. A turned-off line is not a pass and not a fail. It adds no issue, so the customer is not asked about it.

If a check that can stop a case is off, no claim goes STP. Each claim checked while the check is off needs a person (JD3) to approve it in IAS. If you switch the check on again later, those claims still need approval.

## Switch a check on

Select *Switch on* on the card, type the reason, and save. The check runs again on cases checked from then on.

## When a switch applies

A switch applies to the next check of a case: a new case, a re-check after an upload, or a re-check after a correction. A case that was already checked keeps its result.

## Checks that cannot be switched off

These five checks protect the payment or the IAS revision. The page shows them as *Locked on*:

1. The member is in IAS.
2. The policy was active on the treatment date.
3. The bank details match IAS.
4. There is enough balance for each voucher.
5. There is a voucher.

The information lines (what the AI read) have no switch, because they never stop a case. The doctor name check and the diagnosis check are off in the code. They cannot be switched on from this page.

## History

The page shows only the last change of each check. The table `ulink_check_switches` keeps every change: the check code, on or off, the person, the date and the reason.
