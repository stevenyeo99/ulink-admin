# IAS API Case Analysis and PRD

Status: draft for confirmation  
Scope: `ulink-admin/src/ulink-api` only  
Date: 2026-09-23

## 1. Executive decision

The API case should use a separate orchestrator entry point and a separate
source-aware lifecycle. It should not be added to the existing email
orchestrator as another unqualified `Case.currentStatus` consumer.

The existing email pipeline is already a live, status-driven flow:

```text
email-intake
  -> claim-recognition
  -> member-verification
  -> document-checking
  -> email tasks
  -> console-upload
  -> ias-claim-preparation
  -> ias-claim-creation
  -> optional ias-claim-stp
```

Its input is an IMAP/Freshdesk-style email submission with `EmailThread`,
`EmailMessage`, and `EmailAttachment` records. Its jobs select cases by
`Case.currentStatus`; several also assume email records exist.

The API case has a different intake contract and should not silently enter
that chain.

## 2. Repository evidence

The existing email orchestrator is:

- `ulink-admin/src/ulink-api/modules/pipeline/service.js`
- `ulink-admin/src/ulink-api/routes/jobs/pipeline.js`
- `ulink-admin/src/ulink-api/controllers/job/pipelineController.js`

It executes a fixed list of jobs and continues after an individual step fails.
Each job has its own lock and independently selects eligible cases. The
registry is documented in:

- `ulink-admin/docs/imp/day1/jobs-registry.md`

The current `Case` model has email-oriented defaults and relationships:

- `currentStatus` defaults to `EMAIL_RECEIVED`.
- Cases are related to `EmailThread`, `EmailTask`, and `CaseEvent`.
- The case detail API loads the email thread and email attachments.
- `email-intake` creates and correlates email cases.
- `claim-recognition` gathers documents through email attachment records.
- `email-sender` expects an inbound email message to reply to.

Therefore, creating an API case directly in `ulink_cases` without a source
boundary would make it eligible for email jobs and could cause missing-record
errors, incorrect email tasks, or duplicate IAS work.

## 3. Problem statement

An external or internal API must submit an IAS claim case without using email
intake, while preserving the current email AYAS route exactly as it is.

The API flow needs its own:

- intake contract;
- document ownership and storage reference;
- orchestration trigger;
- status transitions;
- idempotency and processing lock;
- audit trail;
- result and error contract.

## 4. Goals

1. Accept API-originated claim cases in `ulink-admin`.
2. Keep email cases and API cases isolated.
3. Reuse suitable existing claim/document/IAS modules where ownership fits.
4. Make long-running work asynchronous and observable.
5. Prevent duplicate IAS submission on request or worker retry.
6. Support JPG, JPEG, PNG, and PDF in the first version unless product scope
   says otherwise.
7. Preserve an auditable case history and final IAS result.

## 5. Non-goals

- Do not change the current email pipeline behavior.
- Do not make email jobs process API cases.
- Do not create fake email threads or email messages for API cases.
- Do not build a general workflow engine.
- Do not add Freshdesk/email replies to the API path unless explicitly needed.
- Do not accept arbitrary server-local file paths from an API caller.
- Do not duplicate existing OCR, document-checking, or IAS business rules.

## 6. Recommended architecture

### Preferred first design: shared case store, separate source and orchestrator

Use the existing database, but add an explicit source discriminator and an API
submission record or API-specific fields. Add a separate API orchestrator that
only selects `source=API` cases.

```text
POST /api/ias-cases
  -> API intake validates and stores request/documents
  -> API case: RECEIVED
  -> API orchestrator: document/OCR/validation
  -> API orchestrator: member/coverage checks
  -> API orchestrator: IAS payload preparation
  -> API orchestrator: IAS submission
  -> API orchestrator: result/status handling
```

The email pipeline remains:

```text
POST /api/jobs/pipeline/run
  -> only email-originated cases
```

This gives operators one database and audit surface, but two explicit
pipelines. The critical requirement is that every existing email job is
protected by the source boundary before API records are introduced.

### Safer alternative if source changes are not acceptable

Create an API-specific table, for example `ulink_ias_api_cases`, with its own
status column and event table. This requires more schema but guarantees that
the current email jobs cannot select API cases.

Recommendation: use the shared case store only if adding and enforcing
`Case.source` can be done in one migration and every existing job query is
updated and tested. Otherwise choose the separate table.

## 7. API case lifecycle

Suggested statuses:

```text
API_RECEIVED
API_DOCUMENTS_STORED
API_PROCESSING
API_DOCUMENTS_RECOGNIZED
API_MEMBER_VERIFIED
API_READY_FOR_IAS
API_CLAIM_SUBMITTED
API_COMPLETED
API_VALIDATION_FAILED
API_MANUAL_REVIEW
API_IAS_REJECTED
API_RETRYABLE_FAILURE
```

These names should not reuse email statuses such as
`READY_FOR_DOCUMENT_READING`, `MEMBER_VERIFIED`, or
`DOCUMENTS_UPLOADED`; those names currently drive email-job selection.

Basic flow:

```text
RECEIVED
  -> validate request and documents
  -> DOCUMENTS_STORED
  -> recognize/extract documents
  -> DOCUMENTS_RECOGNIZED
  -> member and coverage verification
  -> API_MEMBER_VERIFIED
  -> build and validate IAS payload
  -> API_READY_FOR_IAS
  -> submit once to IAS
  -> API_CLAIM_SUBMITTED
  -> API_COMPLETED
```

Every step should be resumable from its persisted status. A technical failure
should not advance the case; a definitive business rejection should not be
blindly retried.

## 8. Proposed endpoints

### Create API case

```http
POST /api/ias-cases
Idempotency-Key: <client-generated-key>
Content-Type: multipart/form-data
```

Minimum fields:

```text
claimType: provider_claim | reimbursement_claim
documents[]: PDF/JPG/JPEG/PNG
```

Response:

```json
{
  "caseId": "uuid",
  "status": "API_RECEIVED",
  "statusUrl": "/api/ias-cases/{caseId}"
}
```

### Get API case

```http
GET /api/ias-cases/:caseId
```

Returns status, safe error information, processing timestamps, and final
business results. Raw medical documents should not be returned unless an
authenticated operator endpoint explicitly requests them.

### Optional manual retry

```http
POST /api/ias-cases/:caseId/retry
```

Only retry statuses classified as technically retryable.

### API worker trigger

```http
POST /api/jobs/ias-api-case/run
```

This job must select API cases only. It should not be added as a step inside
the email pipeline unless a later decision intentionally wants one combined
cron trigger.

## 9. Orchestrator behavior

The API orchestrator should follow the existing job conventions where useful:

1. Acquire a dedicated `ias-api-case` job lock.
2. Select a bounded batch of eligible API cases.
3. Acquire a per-case lock or claim rows atomically.
4. Run the next eligible API step.
5. Persist status, outputs, and a `CaseEvent`/API event.
6. Classify the error as validation, business, manual-review, or retryable.
7. Release locks in `finally`.

Unlike the current pipeline, the API worker may need to process one case
through multiple steps in one run or one step per run. Default recommendation:
one step per case per run. It is easier to retry safely and keeps external IAS
calls isolated.

### IAS duplicate invariant

After an IAS submission may have reached IAS, a timeout is not proof of
failure. The case must enter a reconciliation/manual-review state unless IAS
provides a safe idempotency key or a query that can determine whether the
claim was created. Never blindly resubmit after an unknown outcome.

## 10. Data model requirements

Minimum API-specific data:

```text
source                 API
apiCaseType            provider_claim | reimbursement_claim
externalCaseId         caller's reference, optional
idempotencyKeyHash     unique per API client/scope
inputFingerprint       normalized request/document hash
documentManifest       metadata and storage references
apiStatus              API lifecycle status
apiResult              final safe result
apiError               code, message, retryability
attemptCount           per step or submission attempt
```

Keep original documents unchanged. Store generated OCR/raster files as
derived artifacts with a link to their source document.

If the existing `Case` model is reused, add a source-aware relationship rule:

```text
Email jobs       -> source = EMAIL
API orchestrator -> source = API
```

The source predicate must be present in every job query, not only in the API
worker query.

## 11. Trust-boundary rules

- Accept uploads or approved object-storage references, not arbitrary local paths.
- Validate actual file signatures as well as MIME type and extension.
- Limit file count, per-file size, total request size, and processing time.
- Generate storage keys; never use a raw client filename as a path.
- Sanitize logs and API responses so medical data and credentials are not leaked.
- Authenticate the API and authorize case lookup/retry by tenant or caller.
- Do not expose internal IAS payloads or raw documents to an untrusted caller by
  default.

## 12. Acceptance criteria

### Isolation

- An API submission creates no `EmailThread`, `EmailMessage`, or email reply task.
- The email pipeline does not select or modify an API case.
- The API worker does not change an email case's status.
- Existing email pipeline tests pass unchanged.

### Reliability

- Repeating the same `Idempotency-Key` returns the same API case.
- Concurrent workers cannot process one API case simultaneously.
- A successful IAS submission is not submitted a second time by retry.
- Unknown IAS submission outcomes become reconciliation/manual review.
- Restarting the service leaves the API case resumable.

### Documents

- JPG, JPEG, PNG, and PDF are accepted after content validation.
- Unsupported or corrupt files stop before OCR.
- Original files remain available for audit and reprocessing.

### Operations

- Operators can list API cases by API status.
- Each step has an event with timestamp, attempt, outcome, and safe error.
- A final API result clearly distinguishes completed, rejected, manual review,
  and retryable failure.

## 13. Questions for confirmation

### Scope

1. What exactly is the API source: an external client upload, an internal
   Console action, or another system callback?
2. Is the first API case provider claim, reimbursement claim, or both?
3. Should the API path stop after IAS claim creation, or also handle claim
   status/CSR retrieval?
4. Should API cases ever send email, or should the caller poll the API only?

### Boundary

5. May API cases share the existing `ulink_cases` table if `source` is added,
   or must they have a separate API-case table?
6. Should the API case pass through the same document-checking/member-verification
   rules as email cases, or is there a different business checklist?
7. Is Console upload required for API cases before IAS submission?
8. Should API cases appear in the existing Console case list, or have a separate
   view?

### Input and identity

9. Will clients upload `multipart/form-data`, or provide object-storage keys?
10. What are the maximum number and size of documents?
11. Are TIFF/BMP/GIF/WEBP required, or only PDF/JPG/JPEG/PNG?
12. What authentication, tenant, and case-ownership rules are required?
13. Is there an external case/reference ID that must remain searchable?

### Processing and failure policy

14. Must processing be asynchronous, or is a synchronous response required for
    small cases?
15. What should happen when OCR is incomplete or ambiguous: reject, manual
    review, or continue with operator approval?
16. Which IAS responses are definitive business rejection versus retryable
    technical failure?
17. How should an IAS timeout be reconciled when the claim may already exist?
18. Who may retry or manually advance an API case?

## 14. Recommended defaults if no decision is available

- Use a separate API source and a dedicated API orchestrator.
- Keep the existing email orchestrator unchanged except for mandatory source
  filtering if the same `Case` table is reused.
- Start with provider and reimbursement claim types only if both are already
  required; otherwise ship one route first.
- Use asynchronous processing with polling.
- Accept authenticated PDF/JPG/JPEG/PNG uploads.
- Keep Console upload and email notifications out of the first API release
  unless required by the business process.
- Treat uncertain IAS submission outcomes as manual reconciliation.
- Add one isolation test that proves an API case is invisible to every email
  job.

