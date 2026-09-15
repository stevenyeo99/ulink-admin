# LLM Document Checking Accuracy Architecture

## Purpose

Improve OCR accuracy and document-checking judgments for invoices and medical records while preserving the current Day-1 pipeline and its existing case statuses.

The system should use the original document as the source of truth. OCR is an evidence-extraction step; it is not permission for the model to invent or silently correct values.

## Current architecture

```text
Inbound document
  -> rasterize pages
  -> transcribe each page with the vision LLM
  -> store extracted claim fields
  -> deterministic document checks
  -> LLM judgment for semantic checks
  -> case status and email task
```

This is the correct baseline for variable-format documents. It is cheaper, more repeatable, and easier to audit than sending every complete document directly to a vision model for one unrestricted decision.

## Target architecture

```text
Original document (always preserved)
  -> preprocess page
  -> OCR/transcription
  -> OCR evidence + confidence + page provenance
  -> deterministic validation and reconciliation
  -> decision input assembled from relevant evidence
  -> text LLM judgment
  -> image fallback for ambiguous evidence
  -> PASS / FAIL / MANUAL_REVIEW
  -> case status, audit event, and email task
```

The normal path remains OCR-first. Image review is a controlled fallback, not a replacement for the existing pipeline.

## Responsibilities

### 1. Original document

- Keep the original attachment unchanged in storage.
- Never overwrite it with a rasterized or OCR version.
- Keep enough metadata to identify the source attachment and page.

### 2. OCR/transcription

The OCR prompt must be transcription-only:

- Copy visible content.
- Preserve numbers, dates, names, and currency exactly as seen.
- Do not infer missing values.
- Do not decide whether the document passes.
- Mark unreadable text as uncertain.
- Return page/document references.

The OCR model should use the exact reasoning value supported by the configured model. This is configured through `.env`, not hardcoded to one model family.

### 3. Evidence record

Existing extracted fields remain usable. Accuracy improvements should add optional evidence rather than replace them immediately.

Example:

```json
{
  "value": "45,000",
  "normalizedValue": 45000,
  "page": 2,
  "document": "invoice",
  "sourceText": "Total Amount: 45,000 MMK",
  "confidence": 0.94
}
```

Evidence should identify:

- Original attachment or document ID.
- Page number.
- Field name.
- Raw OCR text.
- Normalized value, when normalization is deterministic.
- OCR confidence.
- Any conflicting occurrences.

### 4. Deterministic checks

Normal application code should own checks that do not require interpretation:

- Required document presence.
- Required field presence.
- Amount and invoice-total arithmetic.
- Currency validation.
- Date parsing and format validation.
- Duplicate document detection.
- Exact or normalized identifier comparison.
- Conflicting values across pages.

If a critical value is missing or conflicts with another value, do not silently select one. Return `MANUAL_REVIEW` or send the case to the judgment step with the conflict explicitly stated.

### 5. LLM judgment

The judgment LLM should receive only the relevant evidence needed for the question:

- Claim information.
- Relevant invoice evidence.
- Relevant medical-record evidence.
- Page references and source quotations.
- Extracted values and conflicts.
- Deterministic check results.

It should return a strict structure such as:

```json
{
  "decision": "PASS",
  "confidence": 0.87,
  "evidence": [
    { "page": 3, "quote": "Diagnosis: acute gastritis" }
  ],
  "missingInformation": [],
  "reason": "The medical record describes treatment consistent with the claimed condition."
}
```

Allowed decisions:

- `PASS`: sufficient evidence supports the check.
- `FAIL`: sufficient evidence contradicts the check.
- `MANUAL_REVIEW`: evidence is missing, unreadable, contradictory, or too uncertain.

The model must not turn an absent value into a positive decision. Low confidence must result in `MANUAL_REVIEW`.

### 6. Image fallback

Use the original page image when:

- OCR confidence for a critical field is below the configured threshold.
- OCR contains contradictory values.
- The decision depends on layout, a stamp, handwriting, checkbox, signature, or table structure.
- The text judgment cannot determine the result.

The image fallback should receive the same question and should return the same decision schema. The fallback must remain observable in the case audit trail.

## Document-checking examples

### Invoice

Use deterministic checks for amount, currency, date, required invoice fields, and totals. Use the LLM only for questions such as whether a document appears to be an invoice or whether a description is consistent with the claimed treatment.

### Medical record

Use OCR evidence and page references to ask whether the record supports the claim's diagnosis or treatment. The LLM may judge semantic similarity, but it must not diagnose a condition or create a medical fact that is absent from the record.

### Entity matching

For names such as a provider or hospital, provide both the extracted values and their source quotations. Abbreviations and aliases may be judged by the LLM, but uncertain matches should become `MANUAL_REVIEW`.

## Backward-compatible rollout

### Phase 1: prompt and observability

- Improve transcription and judgment prompts.
- Log model, reasoning setting, page, evidence, decision, and confidence.
- Keep current database fields and status transitions unchanged.

### Phase 2: optional evidence

- Add optional OCR confidence and provenance fields.
- Keep existing extracted fields populated as before.
- Use evidence only to improve judgment input and console visibility.

### Phase 3: controlled fallback

- Enable image fallback only for low-confidence or conflicting cases.
- Preserve the existing OCR-first path for normal cases.
- Track fallback outcomes separately.

### Phase 4: console review

Show the operator:

- Original document.
- OCR text.
- Extracted values.
- Page/source evidence.
- Deterministic checks.
- LLM decision, confidence, and reason.
- Manual-review trigger.

No existing status name or email behavior should change merely because evidence is displayed.

## Model configuration

Reasoning values must be configured according to the selected model server. The application should pass through the configured values rather than assume one universal vocabulary.

Example for a model supporting levels:

```env
LLM_REASONING_EFFORT=low
DOCUMENT_CHECKING_REASONING_EFFORT=medium
```

Example for a model supporting switches:

```env
LLM_REASONING_EFFORT=off
DOCUMENT_CHECKING_REASONING_EFFORT=on
```

The API must be restarted after changing `.env`.

## Accuracy and safety metrics

Evaluate OCR and judgment separately:

- OCR field accuracy by document type and field.
- Number of unreadable or conflicting critical fields.
- Judgment precision and recall for `PASS` and `FAIL`.
- Manual-review rate.
- Image-fallback rate.
- False-pass rate for critical checks.
- Processing time and LLM token/image cost.

Maintain a labeled set of real, anonymized examples containing different layouts, poor scans, handwriting, stamps, missing documents, and semantically similar but incorrect medical records.

## Invariants

- Original documents are never modified or discarded.
- OCR never makes the final business decision by itself.
- Deterministic rules remain deterministic.
- The LLM cannot approve missing evidence by guessing.
- Uncertainty and conflicts lead to manual review.
- Existing case statuses, retries, and email tasks remain compatible.
- Every automated judgment is explainable through stored evidence and a reason.

## Conclusion

The current OCR-first architecture should remain the foundation. The safest accuracy improvement is to add provenance, confidence, deterministic reconciliation, stricter judgment output, and image fallback for ambiguous cases. These improvements are additive and do not require replacing the current pipeline with an image-only LLM workflow.
