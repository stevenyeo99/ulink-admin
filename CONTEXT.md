# ULINK Claims Automation

Automated first-level processing of AYA Sompo health claims for ULINK, the TPA: reading the claim, checking it
against IAS, preparing it in IAS, and explaining every decision, so that people only handle what needs judgement.

## Parties and roles

**AYA Sompo**:
The insurer whose health claims are processed.
_Avoid_: the client (ambiguous)

**AYAS**:
AYA Sompo's company code in IAS; also the name of the one claim route handled today (AYAS member claim).

**ULINK**:
The TPA (third-party administrator) that processes claims for AYA Sompo and owns this system.

**DRT**:
The team building and running this system.

**Member**:
The insured person in IAS whose policy covers the claim, identified by NRC / passport.
_Avoid_: patient, customer (when the IAS record is meant)

**Claimant**:
The person who submitted the claim, as written on the claim form; usually the member.

**Policy holder**:
The company (or person) holding the group policy the member belongs to, e.g. East-West Seed.
_Avoid_: company (ambiguous)

**Customer**:
Whoever receives our customer-facing emails for a case — the claimant for email cases.

**JD1**:
First-level claims processing: checking a claim and preparing it in IAS. What this system automates.

**JD2**:
The claims approver who approves a non-STP claim in IAS. The system never approves; it hands over to JD2.

**CSR / Ops**:
The team that handles cases needing a person (review queue, internal emails). Here "CSR" means this team only when
paired with Ops — see *Settlement report*.

## Systems

**IAS**:
AYA Sompo's core insurance system: members, policies, plans, claims. Also written *iAS*.

**Console**:
The document console where a claim's documents are filed under a barcode; API-case customers upload there.

**Console middleware**:
The service in front of the console that lists a case's documents and barcodes.

## Claims and cases

**Case**:
One unit of work in this system: one email submission, or one IAS claim. Has a source and a status.
_Avoid_: ticket, job (a job is a processing step)

**Email case**:
A case that starts from a claim emailed by the customer. The system creates its IAS claim.

**API case**:
A case that starts from a claim already created in IAS (the customer used the console). The system revises that claim.

**Claim**:
The claim record in IAS, identified by its *claim number*.

**Claim number**:
IAS's number for a claim (e.g. 2609170003); called `clNo` in the IAS API.
_Avoid_: case number

**TPA case number**:
ULINK's number for a submission, `AYA-CL-` + 8 digits, printed on the claim form. The key the console files documents under.
_Avoid_: case id (the system's internal id), claim number

**Issue number**:
The claim form's own reference, `CL/YGN/AYH/…`; sent to IAS as the TPA claim number.

**Route**:
A kind of claim the system knows how to read and check, e.g. AYAS member claim. Recognition picks one per case.
_Avoid_: claim type (IAS uses that for something else)

**Voucher**:
One invoice or receipt in a claim (consultation, lab, pharmacy, optical). A claim can have several.
_Avoid_: bill (fine in speech, but one word in writing)

**Claim line**:
One line of the IAS claim; one per voucher, each with its own amount and benefit.

## Checks and decisions

**Recognition**:
Reading every page of a case and deciding its route and fields.

**Member check**:
Comparing the claim with the member's IAS record: coverage on the treatment date, date of birth, bank details, policy.
_Avoid_: member verification (the job's name), eligibility check

**Coverage period**:
The dates the member's plan is active; the treatment date must fall inside it.

**Document check**:
The checklist deciding whether a case has every required document and field, clear and consistent.

**Missing documents**:
What the document check found absent or unclear; sent to the customer as a numbered list with a reason per item.
_Avoid_: incomplete documents (use for the status only)

**Delegation**:
A claim paid to someone other than the member, which needs a delegation letter.

**Exclusion clause**:
A clause of the policy wording that excludes (or caps) a kind of treatment, e.g. 6.22 weight loss. A possible match is
a warning for JD2, never a rejection.

**Policy holder override**:
A policy holder's agreed exception to the standard wording, e.g. vaccinations covered.

**Diagnosis code**:
The ICD-10 code sent to IAS for a claim. **R69** is the code used when no diagnosis could be determined.

**Benefit type**:
The IAS category a claim line is paid under: **IP** inpatient, **OP** outpatient, **DT** dental, **VS** vision,
**PA** personal accident. Each has *benefit heads* below it.

**STP**:
Straight-through processing: a claim that passes every STP rule is paid by IAS without JD2 approval.

**STP rule**:
Whether STP is allowed, and up to what amount, for one case source (email / API) and benefit type.

**Never-STP diagnosis**:
A diagnosis code or code prefix that stops STP whatever the amount; R69 is one.

**Suspense**:
IAS's hold on an API case's claim while documents are missing; lifted by the next revision once they arrive.

**Claim revision**:
Updating an existing IAS claim — how every API case reaches IAS.
_Avoid_: resubmission

**Barcode**:
The console's identifier for one uploaded set of documents (e.g. VSQ9T11875); sent to IAS with the claim. A claim
has one main barcode and up to five *supplementary barcodes*.

**Scan id**:
The console's name for an upload, `API-<TPA case number>-NN`; each further upload of the same case adds a number.

**Settlement report**:
The PDF IAS produces for a paid STP claim, emailed to the customer. Called *CSR* in IAS and in code.
_Avoid_: CSR (in prose — collides with the CSR team)

## Explanation and review

**Assessment**:
The explanation of a case: every decision with its result, reason, confidence, how it was checked, and review points.
_Avoid_: AI summary (fine in speech)

**Journey**:
"Why the case went this way": one line per stage the case reached, with its result and reason, ending where it is now.

**Review point**:
A decision a person should look at, with a reason (AI unsure, unreadable, data mismatch, missing information, rule
hold) and who might be wrong (AI, customer, IAS record).

**Confidence**:
The AI's own 0–1 rating of a judgment; below 0.5 counts as *AI unsure*. A hint, not proof.

**Cross-checked**:
A result the AI read that agrees with an independent source (IAS, another page, a sum). Stronger than confidence.

**Override**:
A person letting a case past a check the AI got wrong, with a finding and a reason, recorded under their name.

**Held**:
A customer email or payment that waits for a person because the AI was unsure (the human-check switches).

**AiSummaryRemark**:
The IAS claim field that stores the assessment, so the explanation is kept in IAS too.

**Review queue**:
Every case waiting for a person, with the reason, oldest first.

**Approvals**:
Non-STP claims in IAS waiting for JD2.
