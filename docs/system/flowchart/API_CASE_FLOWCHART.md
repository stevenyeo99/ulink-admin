# API case flowchart

This chart shows how an API case moves from the IAS claim list to the IAS revision. It shows the pipeline jobs in order, the stops where a person decides, and the emails that go out. The source is `src/ulink-api/modules/pipeline/service.js` (`API_STEPS`) and the input and output statuses of each `api-*` job.

Last checked against the code: 2026-10-27. Published copy: https://claude.ai/artifact/6wQz6VycRj8e3TgdbvYWWg (private, republish it from this file after each change).

Image: [API_CASE_FLOWCHART.svg](API_CASE_FLOWCHART.svg). A Claude Code hook renders it from the chart below after each save of this file (`.claude/hooks/render-api-flowchart.sh`). If you edit the file outside Claude Code, run `.claude/hooks/render-api-flowchart.sh --all`.

When an API job, status, stop, switch or email changes, update this file in the same change. The checklist in `.claude/skills/ulink-pipeline-change/SKILL.md` (step 9) says the same.

## Flow

Blue boxes are pipeline jobs. Orange hexagons are stops that wait for a person. Green boxes are end or waiting states. Purple shapes are emails.

```mermaid
flowchart TD
  classDef job fill:#e8eef7,stroke:#6b7c96,color:#1d2430
  classDef stop fill:#fdecd9,stroke:#c2410c,color:#1d2430
  classDef done fill:#e3f2ea,stroke:#3f8a5f,color:#1d2430
  classDef mail fill:#efe9f8,stroke:#7a5ea8,color:#1d2430

  A[1 · Claim intake<br/>IAS claim list → API_RECEIVED]:::job --> B[2 · Material download<br/>console images → PDF]:::job
  W[Console watch<br/>new documents for waiting cases]:::job -.->|new console images| B
  B -->|no images| ND{{API_NO_DOCUMENTS}}:::stop
  ND -.-> E1[/Customer: missing documents<br/>team instead while the switch is off/]:::mail
  ND -->|case-page upload| UP
  B --> C[3 · Claim recognition<br/>AI reads every page]:::job
  UP[Case-page upload<br/>API_UPLOAD_RECEIVED]:::job -->|read again at once| C
  C -->|too long / unreadable| MR{{API_MANUAL_REVIEW}}:::stop
  C --> D[4 · Member verification<br/>member, policy, bank vs IAS<br/>AI head per voucher + IAS balance<br/>IAS exclusions judged by meaning<br/>policy contract exclusion]:::job
  D -->|mismatch / balance not enough /<br/>possible exclusion| MV{{API_MEMBER_REVIEW_REQUIRED<br/>rechecked every run}}:::stop
  MV -.-> E3[/Team: member verification hold/]:::mail
  MV -->|override / IAS fixed / Mark OK or Bypass| E
  D -->|AI unsure of a voucher's head| BR{{API_BENEFIT_REVIEW}}:::stop
  BR -->|person chooses the head| D
  D -->|verified| E[5 · Document checking<br/>checklist + AI confidence]:::job
  E -->|complete, AI unsure| DU{{API_DOCUMENTS_UNSURE}}:::stop
  DU -->|person confirms| F
  E -->|missing, AI unsure<br/>or a person corrected items| DR{{API_DOCUMENTS_REVIEW}}:::stop
  DR -.-> E4[/Team: check before the customer is asked/]:::mail
  DR -->|documents are missing| F
  DR -->|case-page upload| UP
  DR -->|override: documents fine| F
  E -->|complete| F[6 · Console upload<br/>case-page uploads to IAS console]:::job
  E -->|missing, AI sure| F
  E -.->|missing, AI sure| E9[/Customer: missing documents<br/>skipped while the switch is off/]:::mail
  F -->|uploads sent| G[7 · Console barcode<br/>waits for barcodes]:::job
  F -->|failed| CU{{API_CONSOLE_UPLOAD_FAILED}}:::stop
  CU -->|retry from the case page| F
  G -->|overdue| CB{{API_CONSOLE_BARCODE_MISSING<br/>checked again every run}}:::stop
  CB -->|barcode arrives| H
  F -->|no uploads| H
  G --> H[8 · Claim preparation<br/>ICD-10, benefit, rejections, STP, suspense]:::job
  H -->|AI unsure of diagnosis,<br/>benefit or vitamins| PR{{API_PREPARATION_REVIEW}}:::stop
  H -->|balance dropped while waiting<br/>new shortage| BL{{API_BALANCE_REVIEW}}:::stop
  BL -->|Bypass with a reason,<br/>or balance enough again| H
  PR -->|person chooses| H
  PR -->|choices + corrections, one save| E
  H --> I[9 · Claim revision<br/>POST to IAS]:::job
  I -->|documents missing<br/>isSuspense=Y| S([API_CLAIM_SUSPENDED<br/>waits for the customer]):::done
  S -.-> E5[/Team: documents incomplete/]:::mail
  S -.->|new documents| W
  S -->|case-page upload| UP
  W -->|older upload not in<br/>the console in time| UNC{{API_UPLOAD_NOT_IN_CONSOLE}}:::stop
  I -->|complete, not STP| R([API_CLAIM_REVISED<br/>JD3 approves in IAS]):::done
  R -.-> E6[/Team: claim ready for review/]:::mail
  I -->|IAS refused| RF{{API_CLAIM_REVISION_FAILED}}:::stop
  RF -.-> E7[/Team: claim submit issue/]:::mail
  I -->|complete, STP| AW([API_AWAITING_CSR<br/>waits for the settlement report]):::done
  AW --> J[10 · Claim STP<br/>downloads the settlement report]:::job
  J --> CSR([API_CSR_SENT]):::done
  J -.-> E8[/Customer: settlement report/]:::mail
```

## Where a person decides

| Stop | Why the case waits | What the person can do | Switch |
|---|---|---|---|
| `API_NO_DOCUMENTS` | The IAS console has no images for the claim. | Upload on the case page, or wait. Console watch checks every run. | None |
| `API_MANUAL_REVIEW` | The documents are too long for the AI, or its answer did not match the claim schema. | Handle the claim by hand. | None |
| `API_BENEFIT_REVIEW` | The AI was not sure of a voucher's benefit head (switch `holdUnsureBenefit`). | Choose the head from the member's plan on the *Choose the benefit* panel, and correct a misread amount. The member check runs again and checks the balance. | None |
| `API_BALANCE_REVIEW` | The member balance dropped while the case waited for its documents: a voucher no longer fits. | Bypass with a reason (the only action). The revision is then prepared and never goes STP. Asked again every run: goes on by itself once the balance is enough. | None |
| `API_MEMBER_REVIEW_REQUIRED` | Member, policy or bank details differ from IAS, or the IAS balance is not enough for a voucher (`member:balance`), or the claim may fall under a member or policy exclusion in IAS (`member:exclusion`) or a policy contract clause (`member:contract_exclusion`). | Fix IAS (rechecked every run), Mark OK, correct a value, or override. A short balance or a possible exclusion in IAS: Bypass with a reason only, and the claim then never goes STP. A contract exclusion: *Does not apply* (STP stays possible) or *Let it go on* (never STP). | None |
| `API_DOCUMENTS_UNSURE` | The documents are complete, but the AI was unsure of an item. A reviewer's open request line also holds the case here, even when the switch is off. | Use the `Confirm and continue` button, or correct a value. | `holdUnsureDocumentPass` |
| `API_DOCUMENTS_REVIEW` | Documents are missing and the AI was unsure, or a person corrected items. | Documents are missing: continue (suspended revision). Documents are fine: override. Or correct a value. | `holdUnsureMissingDocsEmail` |
| `API_CONSOLE_UPLOAD_FAILED` | Case-page uploads did not reach the IAS console. | Retry from the case page. | None |
| `API_CONSOLE_BARCODE_MISSING` | Case-page uploads got no barcode in time. | Nothing to click: the barcode job checks again every run and continues when the barcode arrives. If it stays, look in the IAS console. | None |
| `API_UPLOAD_NOT_IN_CONSOLE` | Older cases only: an upload from the case page did not appear in the IAS console in time. | Look in the IAS console. Console watch keeps checking every run. | None |
| `API_PREPARATION_REVIEW` | The AI was unsure of the diagnosis code, a voucher's benefit, or its vitamins. | Choose. With corrections, one save sends both, and the case is checked again first. | `holdUnsureDiagnosis`, `holdUnsureBenefit`, `holdUnsureVitamin` |
| `API_CLAIM_REVISION_FAILED` | IAS refused the revision. | Retry from the case page. | None |

## Rules that are easy to miss

- A case-page upload is possible at `API_NO_DOCUMENTS`, `API_CLAIM_SUSPENDED`, `API_DOCUMENTS_REVIEW` and `API_DOCUMENTS_UNSURE`. The case goes to `API_UPLOAD_RECEIVED`, and the AI reads it again at once. Console upload then sends the files to the IAS console before the revision.
- An STP claim waits at `API_AWAITING_CSR` until IAS has the settlement report. Claim STP checks every run.
- Claim preparation decides STP, and STP never stops the revision. A never-STP diagnosis (ULINK's chronic list, R69), vitamins, an amount over the limit or an open review point sends the claim as non-STP. A check that can stop a case and was switched off does the same. JD3 then approves it in IAS.
- Missing documents never stop the revision. The revision goes with `isSuspense=Y`, and a suspended claim is never STP. The next revision with complete documents sends `isSuspense=N`, and IAS lifts the suspense.
- When `apiSendMissingDocumentsEmail` is on, the customer gets the missing-documents email (no images, or documents missing and the AI sure). When it is off, the customer gets no missing-documents email. ULINK emails the customer from the draft on the case page, and the team gets an email instead.
- A correction sends the case back to the document check. A correction of a value that the member check compares with IAS sends it back to the member check. A correction of the diagnosis or the treatment does the same. The claim preparation choices of a person stay for the next run.
- A super admin can switch a check off on *Admin → AI checklist* (with a reason). The member check and the document check skip it in both flows, and the case shows the line as *Turned off*, never a pass. A switched-off check adds no stop and sends no email. Five checks are locked on: member found, coverage active, bank details, member balance, voucher attached.
- When a job fails because IAS, the console or LM Studio does not answer, the case keeps its status. The next pipeline run tries again.
