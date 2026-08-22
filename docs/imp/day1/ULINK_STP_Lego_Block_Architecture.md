# ULINK STP Lego Block Architecture

Date: 2026-08-21

## Purpose

This document defines the first implementation direction for ULINK STP.

The project should not be built as one large STP engine. It should be built as small, replaceable Lego blocks. Each block has a clear input, process, output, status, and audit trail.

Initial technology direction:

- Runtime/API: Node.js
- Database: Supabase Postgres
- AI/LLM: LM Studio API
- Phase 1 channel: Email IMAP/SMTP
- Phase 2 channel: Freshdesk adapter

## High-Level Flow

```text
Email Intake
-> Document Reader
-> Document Classifier
-> Claim Scope Classifier
-> JD1 Validator
-> Email Output / Missing Document Request
-> JD2 Validator
-> Claim API Payload / Later Claim API Submit
-> End
```

JD2 must run after JD1 passes. JD2 should not run in parallel with JD1 for the first version.

## Core Principle

Each block should follow this shape:

```text
input -> process -> output -> event/status
```

Examples:

```text
email_message_id
-> Email Intake
-> thread/message/attachments stored
-> EMAIL_RECEIVED event
```

```text
case_id
-> JD1 Validator
-> missing voucher + missing treatment date
-> JD1_PENDING_DOCUMENTS event
```

## Important Intake Rule

Do not classify business scope or document type from:

- email subject
- email body
- attachment filename

Email metadata is allowed only for:

- thread matching
- audit trail
- sender/recipient tracking
- received date
- attachment storage reference

Business classification must use actual document content/OCR extraction.

## Initial Supported Scope

First release supports:

```text
Insurer: AYAS
Submission type: Member submission
Claim type: Reimbursement
```

This must be config-driven so future insurers and claim types can be added later.

Example configuration:

```yaml
stp_profiles:
  ayas_member_reimbursement:
    enabled: true
    insurer: AYAS
    claim_channel: member
    claim_type: reimbursement
    classification:
      use_email_subject: false
      use_email_body: false
      use_attachment_filename: false
      evidence_source: document_content
    primary_review_document: claim_notification
    source_of_truth:
      default: claim_notification
      fallback: e_claim_submission
    use_information_docx: false
    console_upload:
      enabled: false
    jd2:
      validate_member_coverage: true
      validate_member_info: true
      flag_vitamin_supplement: true
      delegation_letter:
        mode: required_on_recipient_mismatch
        unresolved_action: manual_review
```

## Lego Blocks

### 1. Email Intake

Responsibility:

- Read mailbox by IMAP.
- Store every email thread.
- Store every email message.
- Store attachments.
- Preserve email headers for thread matching.
- Make no business decision.

Input:

- Mailbox connection.
- Incoming email message.

Output:

- `email_thread`
- `email_message`
- `email_attachment`
- `case`, if new thread/case is created.

Events/statuses:

- `EMAIL_RECEIVED`
- `ATTACHMENTS_STORED`
- `READY_FOR_DOCUMENT_READING`

### 2. Document Reader

Responsibility:

- Read attachment content.
- Convert supported files where needed.
- OCR image/scanned documents where needed.
- Store extracted raw text.
- Make no JD1/JD2 decision.

Input:

- `email_attachment_id`

Output:

- `document`
- `document_text`
- OCR/extraction metadata.

Events/statuses:

- `DOCUMENT_TEXT_EXTRACTED`
- `DOCUMENT_READING_FAILED`
- `DOCUMENT_NEEDS_MANUAL_REVIEW`

### 3. Document Classifier

Responsibility:

- Classify documents from content only.
- Do not use filename, email subject, or email body.

Initial document types:

- `CLAIM_NOTIFICATION`
- `E_CLAIM_SUBMISSION`
- `MEDICAL_REPORT`
- `VOUCHER_INVOICE_RECEIPT`
- `BANK_INFORMATION`
- `DELEGATION_LETTER`
- `APPROVAL`
- `PROPOSAL`
- `KYC`
- `UNKNOWN`

Input:

- `document_id`
- extracted document text

Output:

- document type
- confidence
- evidence fields/snippets

Events/statuses:

- `DOCUMENT_CLASSIFIED`
- `DOCUMENT_CLASSIFICATION_UNCERTAIN`

### 4. Claim Scope Classifier

Responsibility:

- Decide whether a case belongs to a supported STP profile.
- Use document content, not email metadata.

For Day 1 scope, detect:

- AYAS
- member submission
- reimbursement claim

Input:

- case documents
- classified document types
- extracted document text

Output:

- matched STP profile
- unsupported reason, if not supported

Events/statuses:

- `SUPPORTED_CLAIM_SUBMISSION`
- `UNSUPPORTED_EMAIL_TYPE`
- `CLASSIFICATION_MANUAL_REVIEW`

### 5. Field Extractor

Responsibility:

- Extract structured fields from documents.
- Store raw extraction and normalized values.

Initial fields:

- claimant/member name
- policy number
- member number/reference
- treatment date
- diagnosis/treatment description
- hospital/clinic/provider
- claim amount
- voucher/invoice amount
- bank account holder
- bank account number
- payment recipient
- vitamin/supplement flag

Input:

- document text
- document type

Output:

- structured extraction JSON
- normalized fields
- extraction confidence

Events/statuses:

- `FIELDS_EXTRACTED`
- `FIELD_EXTRACTION_PARTIAL`
- `FIELD_EXTRACTION_FAILED`

### 6. JD1 Validator

Responsibility:

- Act as document completeness and first-level validation gate.
- Use Claim Notification as source of truth.
- Use E-Claim Submission only as supporting comparison.
- Ignore information DOCX.

JD1 checks:

- Supported scope: AYAS + member + reimbursement.
- Required document presence.
- Readability/OCR success.
- Claimant/member identity consistency.
- Policy number consistency.
- Treatment date presence and consistency.
- Diagnosis/treatment description presence.
- Hospital/clinic/provider presence, where applicable.
- Claim amount versus voucher/invoice amount.
- Voucher/invoice completeness.
- Clinic stamp, doctor stamp, or SAMA where required.
- Bank/payment info presence.
- Vitamin/supplement keyword flag.

Input:

- `case_id`
- classified documents
- extracted fields
- STP profile config

Output:

- JD1 result
- missing/incorrect reason codes
- field mismatch list

Events/statuses:

- `JD1_READY_FOR_JD2`
- `JD1_PENDING_DOCUMENTS`
- `JD1_MANUAL_REVIEW`
- `JD1_UNSUPPORTED_SCOPE`
- `JD1_FAILED`

### 7. Email Draft / Sender

Responsibility:

- Generate and send outbound emails.
- Keep replies in the same thread.
- Use canned response as base.
- Include only detected missing/incorrect items.

This block should be separate from JD1/JD2 validators. Validators create email tasks; this block sends them.

Input:

- `email_task_id`
- case/thread information
- reason codes

Output:

- outbound email message
- sent timestamp
- delivery status

Events/statuses:

- `EMAIL_TASK_CREATED`
- `EMAIL_SENT`
- `EMAIL_SEND_FAILED`

Initial templates:

- claim acknowledgement
- missing/incomplete document request
- reminder after no reply
- no-reply resolution notice
- manual-review/internal exception notice, if needed

### 8. JD2 Validator

Responsibility:

- Act as iAS/member coverage and payment validation gate.
- Run only after `JD1_READY_FOR_JD2`.

JD2 checks:

- Member exists in iAS.
- Policy exists and matches claimant/member.
- Coverage active on treatment date.
- Member plan/product benefit exists.
- Benefit appears applicable to claim category.
- Claim data is usable for claim API payload.
- Payment recipient/bank account holder matches claimant.
- Delegation letter required if payment recipient differs from claimant.
- Delegation letter present/readable/signed when required.
- Vitamin/supplement flag passed into claim payload/coding logic.

Input:

- `case_id`
- JD1 result
- extracted fields
- iAS/member lookup result

Output:

- JD2 result
- member/coverage validation result
- payment/delegation validation result
- claim API payload draft

Events/statuses:

- `JD2_READY_FOR_CLAIM_API`
- `JD2_PENDING_DOCUMENTS`
- `JD2_MANUAL_REVIEW`
- `JD2_MEMBER_OR_COVERAGE_NOT_FOUND`
- `JD2_FAILED`

### 9. Claim API Adapter

Responsibility:

- Prepare and later submit claim API request.
- Disabled in first phase if claim API is not ready.

Input:

- JD2-approved claim payload

Output:

- claim API response
- claim number, when created

Events/statuses:

- `CLAIM_API_DISABLED`
- `CLAIM_PAYLOAD_PREPARED`
- `CLAIM_SUBMITTED`
- `CLAIM_CREATED`
- `CLAIM_SUBMIT_FAILED`

### 10. Audit / Event Log

Responsibility:

- Record every block action.
- Make the workflow debuggable and retryable.

Each event should include:

- case ID
- job/block name
- previous status
- new status
- reason code
- short message
- raw result reference
- timestamp

## Suggested Database Tables

Start with these tables:

- `cases`
- `case_events`
- `email_threads`
- `email_messages`
- `email_attachments`
- `documents`
- `document_texts`
- `document_classifications`
- `document_extractions`
- `classification_results`
- `jd1_results`
- `jd2_results`
- `email_tasks`
- `workflow_jobs`

## State Machine

Suggested case statuses:

```text
EMAIL_RECEIVED
READY_FOR_DOCUMENT_READING
DOCUMENT_READING
READY_FOR_CLASSIFICATION
CLASSIFYING
UNSUPPORTED_SCOPE
JD1_PENDING
JD1_PROCESSING
JD1_PENDING_DOCUMENTS
JD1_MANUAL_REVIEW
JD1_READY_FOR_JD2
JD2_PENDING
JD2_PROCESSING
JD2_PENDING_DOCUMENTS
JD2_MANUAL_REVIEW
JD2_MEMBER_OR_COVERAGE_NOT_FOUND
JD2_READY_FOR_CLAIM_API
COMPLETED
FAILED_RETRYABLE
FAILED_NON_RETRYABLE
```

## LM Studio Usage

Use LM Studio API for:

- document type classification
- field extraction
- claim scope classification
- mismatch explanation
- missing-document reason explanation
- email draft generation

Keep deterministic rules in Node.js:

- required document exists
- required field exists
- date comparison
- amount comparison
- name mismatch
- bank holder/payment recipient mismatch
- delegation letter required
- vitamin/supplement keyword flag
- status transition rules

Store both:

- raw LLM response
- normalized application result

## Day 1 Build Plan

### Milestone 1: Email Storage Only

Goal:

```text
Read email -> store thread/messages/attachments -> show case record
```

Deliverables:

- IMAP reader.
- Email thread table.
- Email message table.
- Attachment table/storage.
- Basic case creation.
- Case event logging.

No JD1 logic yet.

### Milestone 2: Document Reading

Goal:

```text
Stored attachment -> extract text/OCR -> store document text
```

Deliverables:

- Document table.
- Text extraction pipeline.
- OCR fallback path.
- Extraction status and error logging.

No document classification yet.

### Milestone 3: Document Classification

Goal:

```text
Document text -> classify document type
```

Deliverables:

- LM Studio classification prompt.
- Document type result.
- Confidence/evidence storage.
- Manual review status for uncertain documents.

### Milestone 4: Scope Classification

Goal:

```text
Case documents -> detect AYAS member reimbursement
```

Deliverables:

- Config-driven STP profile.
- Scope classifier.
- Supported/unsupported result.

### Milestone 5: JD1 Checklist

Goal:

```text
Supported case -> JD1 validation -> ready or pending documents
```

Deliverables:

- Required document checklist.
- Claim Notification source-of-truth logic.
- Field comparison.
- Missing document reason codes.
- JD1 result storage.

### Milestone 6: Missing Document Email

Goal:

```text
JD1_PENDING_DOCUMENTS -> draft/send missing document email
```

Deliverables:

- Email task table.
- Canned-response based template.
- Specific missing item insertion.
- SMTP send.
- Same-thread reply support.

### Milestone 7: JD2 Stub

Goal:

```text
JD1_READY_FOR_JD2 -> member/coverage validation stub -> claim payload draft
```

Deliverables:

- JD2 result table.
- iAS/member lookup adapter interface.
- Delegation-letter rule.
- Vitamin/supplement flag propagation.
- Claim payload draft.

## What Not To Build First

Do not build these in Day 1:

- Freshdesk API integration.
- Console upload.
- Full iAS claim submission.
- Multi-insurer workflow.
- Full claim adjudication.
- Admin dashboard.
- Complex queue system unless needed.

Use Postgres state and jobs first. Add Redis/BullMQ only when volume or concurrency requires it.

## Final Recommendation

Build the smallest working vertical slice first:

```text
Email -> attachments -> document text -> document classification -> AYAS reimbursement scope decision
```

After that, add JD1. After JD1 is stable, add JD2.

This keeps the system maintainable and lets each Lego block be tested, replaced, or improved independently.

