# Claim preparation findings at the document stop (API cases)

Status: built on dev, 2026-11-19. Scope: API flow only. The email flow does not change.

## Why

UAT users said that a case stops for a person too many times. The owner wants two review stops after intake: a member stop, and one stop for the documents and the claim preparation. At that stop, the reviewer sees the document checking findings and the claim preparation findings together (owner, 2026-11-19).

Before this change, the document stop (`API_DOCUMENTS_REVIEW` or `API_DOCUMENTS_UNSURE`) came before claim preparation ran. So the reviewer did not see the diagnosis code, the voucher benefits, or the vitamins yet. After the document decision, claim preparation sometimes stopped the case again at `API_PREPARATION_REVIEW`.

## The approach

The first draft of this plan removed the document stop and moved it after claim preparation. The owner chose a lower-risk approach instead (2026-11-19).

The document stop stays where it is. When the document check stops a case for a person, it also runs claim preparation as a preview. The preview sends nothing to IAS, because only the claim preparation job builds the revision. The review page shows the preview next to the document findings. The reviewer saves the claim choices (diagnosis code, voucher benefits, vitamin rejections) at the same stop. Claim preparation later uses the choices and does not stop again for them.

The hard gate before IAS does not change. The console upload order and every action at the document stop also stay the same.

## Decisions (owner, 2026-11-19)

1. The lower-risk approach above replaces the first draft.
2. The benefit head of each voucher stays at the member stop, because the balance check needs it.
3. The change is built now, before go-live.

## What changed

1. Document check (`src/ulink-api/modules/api-document-checking/service.js`). At `API_DOCUMENTS_REVIEW` and `API_DOCUMENTS_UNSURE`, the output has `preparationPreview`: `{ claimPrepMeta, review, isStp }`. The preview uses the same `checkCase` as claim preparation, with the person's earlier choices. If the preview fails (the AI or IAS does not answer), the output has `{ error }` and the document check still stops as before.
2. Case view (`src/ulink-api/modules/api-pipeline/caseView.js`). The case shows `preparationPreview`.
3. Preparation save (`src/ulink-api/controllers/cases/preparationController.js`). The save also works at the two document stops. It reads the preview, keeps the choices, and does not move the case.
4. Review page (`src/ulink-console/src/components/cases/PreparationReviewPanel.tsx`). At the document stop, the panel shows "Claim preparation findings" from the preview, with the button "Save the claim choices". It does not send the corrections, because the findings save above sends them.

## Known limits

- The reviewer must save the claim choices before the document findings. If the reviewer saves the document findings first, the case moves on without the choices. Claim preparation then stops at `API_PREPARATION_REVIEW` for any unsure point, as before this change.
- A case with clean documents and an unsure claim point still stops once, at `API_PREPARATION_REVIEW`.
- A balance drop while the case waits for documents still stops at `API_BALANCE_REVIEW`.
- The preview adds AI calls (diagnosis search, translation) and one IAS balance read at the document stop.

## Verification

- `npm test` in `src/ulink-api`: 113 suites, 815 tests pass. New tests are in `tests/apiDocumentHold.test.js` (preview on a held case, a failed preview) and `tests/preparationController.test.js` (save at the document stop).
- `npx tsc -b` in `src/ulink-console` passes.
- Still to do on dev: open a case at `API_DOCUMENTS_REVIEW` on the review page. Make sure that the claim preparation findings show, then save the choices and the findings.
