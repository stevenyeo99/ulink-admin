# DRT Claim Demo Implementation Plan

## Goal

Build the demo as small, replaceable blocks until the full claim workflow is complete.

The system should first work with IMAP/SMTP because Freshdesk UAT is unavailable. Later, Freshdesk should replace only the email channel layer, while the core claim workflow remains unchanged.

## Main Design Principle

Do not build the business logic directly inside IMAP, SMTP, or Freshdesk code.

Build the system like this:

```text
Channel Adapter
→ Case Workflow
→ Recognition / Verification / Document Check
→ Action Handler
→ Audit Log
```

Today:

```text
IMAP Reader + SMTP Sender
```

Later:

```text
Freshdesk Reader + Freshdesk Reply/Update
```

The core workflow should stay the same.

---

## Target Workflow

```text
1. Receive submission
2. Recognize whether it is a claim email/ticket
3. Create case record
4. Save email/ticket content and attachments
5. Check documents
6. Verify member
7. Identify missing documents
8. Draft request email if documents are missing
9. Send or forward email
10. Create claim number in iAS if case is complete
11. Save audit trail
```

---

## Recommended Status Flow

```text
NEW
RECEIVED
RECOGNIZED
NOT_RECOGNIZED
DOCUMENT_CHECKED
MEMBER_VERIFIED
MEMBER_REVIEW_REQUIRED
INCOMPLETE
DRAFT_CREATED
MISSING_DOC_REQUEST_SENT
READY_FOR_CLAIM
CLAIM_CREATED
FAILED
MANUAL_REVIEW
```

---

# Lego Block Implementation Plan

## Block 1: Project Skeleton

### Goal

Create the basic project structure and prepare the system for small independent modules.

### Suggested Folders

```text
src/
  channels/
  workflow/
  recognition/
  documents/
  members/
  checklist/
  drafting/
  claim/
  storage/
  audit/
  config/
tests/
sample-data/
```

### Output

A runnable application with a simple health check or command.

### Test

Run the app and confirm it starts successfully.

### Done When

The project can run without doing real processing yet.

---

## Block 2: Case Data Model

### Goal

Create the core case structure used by all modules.

### Minimum Case Fields

```text
caseId
source
externalId
senderEmail
subject
body
status
recognizedType
memberId
memberName
foundDocuments
missingDocuments
claimNumber
createdAt
updatedAt
```

### Suggested Related Records

```text
Case
Submission
Attachment
DocumentCheckResult
MemberVerificationResult
DraftMessage
AuditLog
```

### Output

Ability to create and retrieve a case.

### Test

Create one fake case from sample data and confirm it is saved.

### Done When

Other modules can receive a `caseId` and update the case result.

---

## Block 3: Sample Data Pack

### Goal

Prepare sample cases for repeatable study and testing.

### Recommended Samples

```text
sample-data/
  complete-case/
    email.json
    claim-form.pdf
    invoice.pdf
    receipt.pdf
    medical-report.pdf
    member-id.pdf

  missing-document-case/
    email.json
    claim-form.pdf
    invoice.pdf
    member-id.pdf

  invalid-member-case/
    email.json
    claim-form.pdf
    invoice.pdf
    receipt.pdf
```

### Output

A local sample input that can simulate real email/ticket submissions.

### Test

Load each sample case and print its subject, sender, and attachment list.

### Done When

You can test the workflow without connecting to IMAP, SMTP, Freshdesk, or iAS.

---

## Block 4: Submission Interface

### Goal

Create a common format for both IMAP and Freshdesk.

### Submission Shape

```json
{
  "source": "imap",
  "externalId": "message-id-123",
  "from": "customer@email.com",
  "to": "claims@ulink.com",
  "subject": "Medical claim submission",
  "body": "Please process my claim.",
  "attachments": [
    {
      "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "storagePath": "..."
    }
  ]
}
```

### Output

A standard submission object.

### Test

Load a sample submission and convert it into the standard shape.

### Done When

The workflow can process a submission without knowing whether it came from IMAP or Freshdesk.

---

## Block 5: Local Sample Submission Reader

### Goal

Create the first reader using local sample files.

### Why First

This allows fast testing before connecting to real email.

### Output

`SampleSubmissionReader` returns one or more standard submission objects.

### Test

Run:

```text
Read sample complete case
Read sample missing document case
Read sample invalid member case
```

### Done When

The workflow can receive fake submissions and create cases.

---

## Block 6: Case Intake Workflow

### Goal

Convert a submission into a case.

### Processing

```text
Receive submission
Create case
Save subject/body/sender
Save attachment metadata
Set status = RECEIVED
Write audit log
```

### Output

A created case with saved submission data.

### Test

Process one sample submission and confirm case status is `RECEIVED`.

### Done When

Every incoming submission creates one traceable case.

---

## Block 7: Email Submission Recognition

### Goal

Recognize whether the submission is a claim submission.

### Start With Simple Rules

```text
Subject contains claim/reimbursement/medical
Body contains member ID/policy number
Has one or more attachments
Sender is not internal system email
```

### Output

```json
{
  "recognizedType": "claim_submission",
  "confidence": "high",
  "reason": "Subject contains claim and attachments exist"
}
```

### Test

Use these sample cases:

```text
claim email
non-claim email
unclear email
```

### Done When

Claim emails move to `RECOGNIZED`, while unclear emails move to `MANUAL_REVIEW`.

---

## Block 8: Attachment Storage

### Goal

Save attachments in a stable location and link them to the case.

### Processing

```text
Create case attachment folder
Save attachment files
Store filename, content type, size, storage path
```

### Output

Each case has a list of stored attachments.

### Test

Process one sample case and confirm all attachments are saved and linked.

### Done When

Document checking can read files from stored attachment paths.

---

## Block 9: Document Type Detection

### Goal

Identify what type of document each attachment is.

### Start Simple

Use filename rules first:

```text
claim_form.pdf → Claim Form
invoice.pdf → Invoice
receipt.pdf → Receipt
medical_report.pdf → Medical Report
member_id.pdf → Member ID
bank_account.pdf → Bank Account Proof
```

### Later Enhancement

Use PDF text extraction, OCR, or AI classification.

### Output

```json
{
  "filename": "invoice.pdf",
  "documentType": "Invoice",
  "confidence": "high"
}
```

### Test

Run detection against all sample attachments.

### Done When

Each attachment is mapped to a document type or marked `UNKNOWN`.

---

## Block 10: Member Verification

### Goal

Verify whether the submitted member exists and is active.

### Start With Mock Member Table

```text
Member ID: M001
Name: John Tan
Policy: P10001
Status: Active
```

### Processing

```text
Extract member ID from email body or claim form filename/text
Search mock member table
Check status
Return verified/not found/mismatch
```

### Output

```json
{
  "status": "verified",
  "memberId": "M001",
  "memberName": "John Tan",
  "policyStatus": "Active"
}
```

### Test

Use:

```text
valid member case
invalid member case
missing member ID case
```

### Done When

Valid members continue, invalid or unclear members go to `MANUAL_REVIEW`.

---

## Block 11: Required Document Checklist

### Goal

Define which documents are required for each claim type.

### Example Checklist

```text
Medical Claim:
- Claim Form
- Member ID
- Invoice
- Receipt
- Medical Report
```

### Output

The system can return a required document list by claim type.

### Test

Ask for required documents for `medical_claim`.

### Done When

Checklist rules are stored separately from document detection logic.

---

## Block 12: Missing Document Detection

### Goal

Compare found documents against required documents.

### Processing

```text
Get required documents
Get detected documents
Compare both lists
Save found and missing documents
Update case status
```

### Output

```json
{
  "found": ["Claim Form", "Invoice", "Member ID"],
  "missing": ["Receipt", "Medical Report"]
}
```

### Decision Rule

```text
If missing documents exist → INCOMPLETE
If no missing documents and member verified → READY_FOR_CLAIM
```

### Test

Run against:

```text
complete case
missing document case
```

### Done When

The system correctly separates incomplete and complete cases.

---

## Block 13: Draft Missing Document Email

### Goal

Generate a clear email requesting missing documents.

### Template

```text
Subject: Missing Documents Required for Your Claim Submission

Dear {{memberName}},

Thank you for submitting your claim.

We noticed that the following document(s) are missing:

{{missingDocumentList}}

Please reply with the missing document(s) so we can continue processing your claim.

Regards,
Ulink Claims Team
```

### Output

A saved draft email linked to the case.

### Test

Run against missing document case and review the generated draft.

### Done When

Incomplete cases have a draft message but are not sent automatically.

---

## Block 14: Manual Approval Step

### Goal

Allow user review before sending any email.

### Processing

```text
Show draft
Approve or reject
If approved, allow sending
If rejected, keep case pending manual edit
```

### Output

Draft status:

```text
DRAFT_CREATED
APPROVED
REJECTED
```

### Test

Approve one draft and reject one draft.

### Done When

No outbound email can be sent without approval during demo.

---

## Block 15: SMTP Sender

### Goal

Send approved missing document request emails.

### Safety Rules

```text
Use whitelist recipient emails
Add [DEMO] to subject
Save sent result
Log SMTP response
Handle send failure
```

### Output

Sent email record.

### Test

Send to a test inbox only.

### Done When

Approved drafts can be sent safely and case status updates to `MISSING_DOC_REQUEST_SENT`.

---

## Block 16: Mock iAS Claim Creator

### Goal

Create a claim number for complete cases without real iAS integration.

### Processing

```text
If case status = READY_FOR_CLAIM
Generate claim number
Save claim number
Set status = CLAIM_CREATED
```

### Example Claim Number

```text
CLM-2026-000001
```

### Output

Case has a claim number.

### Test

Run complete case and confirm claim number is created.

### Done When

Complete cases can finish the demo workflow.

---

## Block 17: Audit Log

### Goal

Record every important action and decision.

### Events To Log

```text
Submission received
Case created
Email recognized
Attachment saved
Document detected
Member verified
Missing documents identified
Draft created
Email approved
Email sent
Claim number created
Error occurred
```

### Output

Each case has a timeline.

### Test

Process one complete case and one incomplete case, then view audit log.

### Done When

You can explain every case result from the audit log.

---

## Block 18: Simple Demo Dashboard or CLI

### Goal

Make the workflow easy to test and present.

### Minimum View

```text
Case ID
Sender
Subject
Status
Member verification result
Found documents
Missing documents
Draft email
Claim number
Audit timeline
```

### Output

A simple screen or command that shows case progress.

### Test

Run all sample cases and inspect results.

### Done When

You can demo without reading raw database records or logs.

---

## Block 19: IMAP Reader

### Goal

Replace local sample input with real mailbox reading.

### Processing

```text
Connect to IMAP
Read unread emails
Download body and attachments
Convert to standard submission object
Mark email as processed or store message ID
```

### Output

IMAP emails become standard submissions.

### Test

Send test email to mailbox and confirm case is created.

### Done When

The workflow can process real email without changing the core workflow.

---

## Block 20: Freshdesk Adapter

### Goal

Prepare future replacement of IMAP/SMTP with Freshdesk.

### Freshdesk Reader Should Return Same Submission Shape

```json
{
  "source": "freshdesk",
  "externalId": "ticket-12345",
  "from": "customer@email.com",
  "subject": "Medical claim submission",
  "body": "Ticket description",
  "attachments": []
}
```

### Freshdesk Actions

```text
Read ticket
Download attachments
Reply to ticket
Update ticket fields
Update ticket status
Add internal note
```

### Test

Use mocked Freshdesk ticket data first. Later test with Freshdesk UAT.

### Done When

Freshdesk can replace IMAP/SMTP by changing adapter configuration only.

---

## Block 21: Real iAS Adapter

### Goal

Replace mock claim number generation with real iAS claim creation.

### Processing

```text
Map case data to iAS payload
Call iAS API or integration method
Receive claim number
Save response
Handle duplicate/error cases
```

### Test

Use iAS test environment when available.

### Done When

Complete cases can create real iAS claim numbers.

---

# Suggested Build Order

## Study and Testing Order

```text
1. Project skeleton
2. Case data model
3. Sample data pack
4. Submission interface
5. Local sample reader
6. Case intake workflow
7. Email recognition
8. Attachment storage
9. Document type detection
10. Member verification
11. Required document checklist
12. Missing document detection
13. Draft missing document email
14. Manual approval step
15. SMTP sender
16. Mock iAS claim creator
17. Audit log
18. Demo dashboard or CLI
19. IMAP reader
20. Freshdesk adapter
21. Real iAS adapter
```

## Why This Order

Start with local sample data first. It is faster, safer, and easier to test.

Only connect IMAP, SMTP, Freshdesk, and iAS after the core workflow is already working.

---

# Recommended Demo Cases

## Demo Case 1: Missing Documents

### Input

Email contains:

```text
Claim Form
Invoice
Member ID
```

### Expected Result

```text
Status: INCOMPLETE
Missing: Receipt, Medical Report
Action: Draft missing document email
```

## Demo Case 2: Complete Documents

### Input

Email contains:

```text
Claim Form
Invoice
Receipt
Medical Report
Member ID
```

### Expected Result

```text
Status: CLAIM_CREATED
Claim Number: CLM-2026-000001
```

## Demo Case 3: Invalid Member

### Input

Email contains documents but member ID is not found.

### Expected Result

```text
Status: MANUAL_REVIEW
Reason: Member not found
```

---

# Feedback Handling Strategy

Client feedback should map to one block only where possible.

```text
Email recognition feedback → Recognition module
Document accuracy feedback → Document module
Missing document rules feedback → Checklist module
Email wording feedback → Drafting module
Sending behavior feedback → Channel sender module
Freshdesk feedback → Freshdesk adapter
iAS feedback → Claim adapter
```

This keeps changes small and prevents rewriting the whole system.

---

# Final Target Architecture

```text
SubmissionReader
  - SampleSubmissionReader
  - ImapSubmissionReader
  - FreshdeskSubmissionReader

ReplySender
  - SmtpReplySender
  - FreshdeskReplySender

CaseWorkflow
  - Intake
  - Recognition
  - Document Check
  - Member Verification
  - Missing Document Decision
  - Draft Request
  - Claim Creation

ClaimCreator
  - MockClaimCreator
  - IASClaimCreator

Storage
  - Case Repository
  - Attachment Repository
  - Audit Repository
```

---

# Rule For Maintainability

Every block should have:

```text
Clear input
Clear output
Own test
Own status update
Audit log entry
No dependency on Freshdesk unless it is the Freshdesk adapter
```

If each block follows this rule, the demo can grow safely from simple sample files into a real Freshdesk and iAS integration.
