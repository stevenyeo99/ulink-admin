# Reviewer guide: deciding a case on the review page

This guide is for reviewers (CSR, Ops, super admins). It explains how to decide the findings of a case, and what
happens after you save. Background: `PRD/REVIEW_ACTIONS_PRD.md` and `PRD/REVIEW_LANE_PRD.md`.

## 1. Open a case

1. Open **Review queue** in the sidebar.
2. Click a case. The review page opens with the documents on the left and the AI findings on the right.

The line at the top of the findings says how many findings need your decision, for example "3 findings need your
decision · 1 decided".

## 2. Decide each finding

Each failed or unsure finding is a card with the badge *Needs your decision*. Click *What to do* to read three things:

- What it checks.
- What you can do.
- The risk if you mark it OK.

Then click one button:

| Button | Use it when |
|---|---|
| Mark OK | The document shows that the check is wrong, or the value the AI was unsure of is right |
| Revise | The AI read a value wrong. Enter the right value |
| Ask the customer | The document really is missing or unclear. The customer must send it |
| Mark wrong | A check passed, but the document shows that it must fail |
| View page | You want to see the page of the document that the finding comes from |

A card opens under the finding. Pick a quick reason, or write your own. A reason needs at least 10 characters. Click
*Done*. The card becomes one line, for example "Marked OK, not saved", with *Change* and *Undo*.

A finding with the badge *No action here* has nothing to decide on this page. The customer or an override handles it.

## 3. Add your own request lines

If the customer must send something that no check covers, write it in *Your own request lines* and click *Add line*.
The lines are saved with your decisions. They go to ULINK with the request, never in an automatic customer email.

## 4. Save

*Review and save* stays off until every finding has a decision. *Go to the next one* jumps to the next open finding.
The dialog lists every decision with its reason. Click *Save all and check again*.

## 5. After you save

- The case leaves the Review queue and appears on the **Reviewed** page. The system checks it again at once.
- The page says "Saved. The case is being checked again". Click *Next case*, or *Stay on this case* to watch it.
- While the case is checked again, it is read-only. A banner shows where it is.
- When the check ends, the banner says the result. If the check finds something new, the case comes back to the
  Review queue with only the new finding.
- If you asked the customer, the request goes out after the check, and the claim goes to IAS as suspended.

## 6. The Reviewed page

The **Reviewed** page lists the cases that people decided and that the system is checking again. A red row waited more
than 15 minutes. Its last round can show *Failed* with the error. A super admin can click *Run now* on a row, or select
up to 20 rows and click *Run selected*. After 30 minutes, the normal pipeline takes the case back.
