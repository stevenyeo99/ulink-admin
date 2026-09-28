# 17/09 Meeting Actions — Current Status and What to Do First

Source: `Ulink_AI_Claims_Automation_Meeting_Summary_Action.docx` (same folder).
Status checked against the code on 2026-09-28. Tick **Decide** to choose what to do next.

---

## 1. DRT can build now (no decision needed)

| Decide | # | Action | Where it stands today | Applies to API case | Size |
|---|---|---|---|---|---|
| [x] | 4 | **Missing-documents email as a numbered list** (built 2026-09-28), with a reason for each item | Done: numbered 1. 2. 3., each reason indented under its item (`email-sender/templates.js` renderMissingDocuments). | Yes (same template) | Small — bullets → 1. 2. 3. |
| [x] | 6 | **Acknowledgement email when a new claim arrives** (built 2026-09-28), separate from the later document email | Done: sent once per case when the claim is recognised (email: `claim-recognition`; API: `api-claim-recognition`). No longer sent after the document check. | Yes (send at API intake) | Small–Medium |
| [ ] | 7 | **Internal AI verification summary** (member check + document check result) for cases needing CSR/Ops attention | Partly built: internal emails exist for member issues and IAS rejections, but not a combined AI summary. | Yes | Medium |
| [ ] | 10 | **Enrich the manual-approval (JD2) email** with AI assessment, issue/reason, next review point | Email exists; carries only claim/case details. | Yes (non-STP API cases) | Medium — build with #7, same content |

## 2. Waiting on a decision or input from Ulink / AYAS

| Decide | # | Action | Where it stands today | Blocked by |
|---|---|---|---|---|
| [ ] | 2, 3 | **Different bank-account holder** → payment/delegation rule instead of failing member verification | Still a hard fail: `bankAccountNameMatch` → `BANK_DETAILS_MISMATCH` in `member-verification/checks.js` | AYAS exception scenario list (Dr KP / Ulink) |
| [ ] | 5 | **Burmese translation** — full email, or at least the missing-documents section | English only | Ulink to confirm scope |
| [ ] | 11 | **Configurable STP rules** — amount, diagnosis, AI confidence, others | Amount only: `ulink_stp_limits` per route + currency (`ias-claim-preparation/stpEligibility.js`) | Ulink + DRT to define rules |
| [ ] | 8 | **Dashboard vs. notification** — what shows on the dashboard, what triggers an email | Not defined | Ulink + DRT |

## 3. Needs design with the iAS team

| Decide | # | Action | Where it stands today |
|---|---|---|---|
| [ ] | 9 | **Keep the AI assessment summary in iAS** (STP and non-STP) for audit | Reasoning kept only in our DB / console; not sent to iAS. Needs a field or API on the iAS side. |
| [ ] | 12 | **Production document upload** — console vs. folder transfer vs. API | Console today. A `cl-upload` API exists (used in demo preparation). |
| [ ] | 13 | **Full iAS/API submission automation** — payload, documents, returned claim number, retry | Claim creation and revision built. Document upload by API not built (the "3rd demo"). |
| [ ] | 1 | **Attachment storage location** (AWS / Ulink local / DRT local) and retention | Local storage adapter today. Needs Ulink + DRT/IT decision. |

---

## Suggested order

1. **Now / right after the demo (small):** #4 numbered email, #6 acknowledgement at intake.
2. **Next:** #7 internal AI summary + #10 richer JD2 email — same content, build together.
3. **Chase at the demo:**
   - AYAS bank-holder exception list (#2)
   - Burmese scope (#5)
   - STP rules (#11)
   - `cl-upload` spec, test account, and an iAS field for the AI summary (#9, #12, #13)

## Key decisions still open (from the meeting)

1. Attachment storage architecture
2. AYAS delegation exception list
3. Burmese translation scope
4. Dashboard vs. notification rules
5. Final STP parameters
6. Console / API integration approach
