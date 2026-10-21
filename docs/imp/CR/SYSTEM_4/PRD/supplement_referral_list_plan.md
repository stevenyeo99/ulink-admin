# Supplement referral list: plan

Status on 2026-10-20: the owner approved the plan. No code is written yet. Continue from step 1.

## Why

Even when some voucher items are medicines, ULINK refers them for a coverage decision as supplements. The AI cannot know this rule from the product.

- AYA-CL-26040946 (case `e1a0fd95-87d1-4518-99ee-538c6156df3d`): ULINK flagged "Montelukast 4mg Chewable Tab (Monty Kid)", 42,000 MMK, on voucher 2. Montelukast is an asthma and allergy medicine, so the AI correctly said "no supplement".
- AYA-CL-26041363: the AI found only "Chewy Vitamin C". ULINK also flagged Minigadine-MV, Aminovit and Superkids Z (brand names).

## Logic

ULINK keeps a list of item names to treat as supplements. When the AI reads a claim, it gets the list and must report any listed item on a voucher, with its amount. After the read, the code also searches each voucher's page text for the listed names. If a listed name is on the page but the AI did not report it, the case stops at the claim preparation panel. A person then enters the amount. A listed item then counts as a supplement: the voucher gets a rejection line (IAS `man_rej` set 1). With `vitaminsBlockStp` on, the claim does not go STP.

This is a plain text match, not RAG. The match ignores upper and lower case. If misread names or other brand names make exact matching fail, use RAG or `pg_trgm` later.

## Steps

Paths are relative to `src/ulink-api/` unless they start with `src/ulink-console/`. Follow the `ulink-pipeline-change` skill checklist.

1. Migration `ulink_supplement_names`: `id`, `name` (unique, no case difference), `note`, `created_at`, `updated_at`. Seed it with Montelukast, Minigadine-MV, Aminovit, Superkids Z and Chewy Vitamin C. Copy the `ulink_stp_blocked_diagnoses` pattern in `db/migrations/20260929100000-stp-rules.js`.
2. Model `db/models/supplementName.js`, like `stpBlockedDiagnosis.js`. `db/models/index.js` loads it.
3. Settings endpoint: `controllers/stp-settings/stpSettingsController.js` (`settingsView`, `validateStpForm`, `saveStpSettings`) gets `supplementNames: [{ name, note }]`. It works like `blockedDiagnoses`: the complete list, left out = unchanged. Update the `@openapi` block in `routes/stpSettings.js`.
4. Console: the STP settings page (`src/ulink-console/src/pages/StpSettingsPage.tsx`) gets a section "Referred items (treated as supplements)", built like the never-STP diagnoses list. Types go in `src/ulink-console/src/api/stpSettingsApi.ts`.
5. AI read: `modules/claim-recognition/service.js` `extractFields` adds the list to the user text, the same way it adds `pastCorrectionNotes`: "Even when these items are medicines, ULINK refers them as supplements: …". The AI puts them in `vitamin_items` with their amounts.
6. Safety net: after the read, for each voucher, find its page text (the transcript chunk whose header matches `item.evidence.page`). If a listed name is in that text but not in `vitamin_items`, set `item.referral_missed = [names]`.
7. Downstream use of `referral_missed`:
   - `modules/document-checking/checklist.js` `vitaminCheck`: the voucher counts as "AI unsure". The note names the missed items.
   - `modules/ias-claim-preparation/service.js`: `lineMeta.vitamin.missed`.
   - `modules/ias-claim-preparation/preparationReview.js` `rejectionUnsure`: missed items count as unsure, so with `holdUnsureVitamin` on, the case stops.
   - `PreparationReviewPanel.tsx`: a flagged voucher with missed items opens with the remark `Montelukast - amount not read is not covered due to supplement.` and an empty amount.
8. Tests: the AI reports Montelukast on voucher 2 (42,000 MMK) → rejection line, no STP. The AI misses it → `referral_missed`, the case stops, the voucher is flagged. The settings form refuses a name listed twice.
9. Record: a dated row in `docs/imp/demo/API DAY1/PREV_FEEDBACK/20260917_enhancement_status.md`, and an update to `docs/imp/CLAIM_FLOW_END_TO_END.md`. Run `npm run db:migrate` on dev. List the migration as a UAT deploy step.

## Open item from the same session

An unsure document check that a person already marked "✓ Right" still stops the case at `API_DOCUMENTS_UNSURE` after a recheck (case `e1a0fd95`). The proposed fix: `modules/document-checking/holdForReview.js` skips an unsure check that has a `kind: confirm` row in `ulink_ai_feedback` on the same case, for the same item and value. The owner did not approve this fix yet.

## Done in the same session (not committed)

- Review page: unique keys for the corrections panel (it showed twice).
- JD3 email says "revised in IAS" for API cases.
- Dashboard sidebar toggle on large screens.
- Vitamin note: each voucher's subtotal and the total. The prompt `extract-fields.md` judges supplements by product. Migration `20261020100000-vitamin-by-product` (descriptions only).
- Manual rejection at the claim preparation stop (switch `holdUnsureVitamin`). "Add rejection to a voucher" shows on every claim.
- "What went wrong?" options `ias_outdated` and `exception`. Migration `20261020110000-ai-feedback-exception-steps`.
- Claim preparation stop: the person's diagnosis code is kept across runs (matched on the claim form text).

The two migrations ran on dev. When you deploy, run both on UAT.
