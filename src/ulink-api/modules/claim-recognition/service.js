const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { sequelize, Case, EmailThread, EmailMessage, EmailAttachment, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { getEnabledRoutes } = require('./routeCatalog');
const { preparePageImages } = require('./rasterize');
const { transcribePage, synthesizeJson } = require('./llmClient');
const { extractLinkedDocumentUrls, fetchLinkedDocument } = require('./linkedDocuments');

const BLOCK_NAME = 'claim-recognition';
const ajv = new Ajv({ allErrors: true });

const TRANSCRIBE_INSTRUCTION = fs.readFileSync(path.join(__dirname, 'prompts', 'transcribe-page.md'), 'utf8');
const SYNTHESIZE_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'synthesize.md'), 'utf8');

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * Every attachment across every INBOUND message in the case's thread(s) — a case can have
 * more than one EmailMessage by the time this runs (e.g. a follow-up email adding another
 * attachment), not just the one that first created it. Excludes outbound messages
 * (email-sender's own replies) — those never carry attachments today, but the filter is
 * explicit rather than incidental, so it stays correct if that ever changes.
 */
async function gatherAttachments(caseId) {
  const threads = await EmailThread.findAll({
    where: { caseId },
    include: [{ model: EmailMessage, where: { direction: 'inbound' }, include: ['EmailAttachments'], required: false }],
  });

  const attachments = [];
  for (const thread of threads) {
    for (const message of thread.EmailMessages) {
      // Excludes attachments previously fetched from a link found in another attachment
      // (sourceUrl set) — those get rediscovered and re-transcribed via the owning
      // attachment's own transcribeLinkedDocuments call below, not as independent
      // top-level attachments (avoids double-counting their transcript on a reprocess).
      attachments.push(...message.EmailAttachments.filter((a) => !a.sourceUrl));
    }
  }
  return attachments;
}

async function transcribePages(buffer, filename, label) {
  const { pages, cleanup } = await preparePageImages(buffer, filename, label);
  try {
    const pageTexts = [];
    for (const page of pages) {
      const imageBuffer = await fs.promises.readFile(page.filePath);
      const text = await transcribePage({ imageBuffer, instruction: TRANSCRIBE_INSTRUCTION });
      pageTexts.push({ pageNumber: page.pageNumber, text });
    }
    return pageTexts;
  } finally {
    await cleanup();
  }
}

/**
 * A generated claim PDF sometimes references a supporting photo by URL instead of
 * embedding it (verified against real sample data — incomplete/jd1/1 and incomplete/jd2,
 * both real cases where a human reviewer clicked through and found the linked document
 * fine; without this, the pipeline would wrongly treat it as absent and flag "No Medical
 * Report(s)"/"Missing voucher(s)"). Only config.linkedDocuments.allowedHosts are ever
 * fetched. A document already fetched for this attachment (e.g. a retried run) is reused
 * from storage rather than fetched and stored again.
 */
async function transcribeLinkedDocuments(attachment, pdfBuffer, storage) {
  const ext = path.extname(attachment.originalFilename || '').toLowerCase();
  if (ext !== '.pdf') return []; // only generated claim PDFs carry this kind of link

  const urls = await extractLinkedDocumentUrls(pdfBuffer, config.linkedDocuments.allowedHosts);
  const pageTexts = [];

  for (const url of urls) {
    let linkedAttachment = await EmailAttachment.findOne({ where: { parentAttachmentId: attachment.id, sourceUrl: url } });

    if (!linkedAttachment) {
      let fetched;
      try {
        fetched = await fetchLinkedDocument(url, {
          timeoutMs: config.linkedDocuments.timeoutMs,
          maxBytes: config.linkedDocuments.maxBytes,
        });
      } catch (error) {
        pageTexts.push(
          `[linked document, referenced from ${attachment.originalFilename || 'attachment'}: ${url}]\n` +
            `COULD NOT BE RETRIEVED (${error.message}) — treat this the same as any other document that could ` +
            'not be read: its content is unknown, not confirmed absent.'
        );
        continue;
      }

      const key = `linked/${attachment.id}/${Buffer.from(url).toString('base64url')}${fetched.ext}`;
      const { storageRef } = await storage.put(key, fetched.buffer);
      linkedAttachment = await EmailAttachment.create({
        messageId: attachment.messageId,
        storageRef,
        originalFilename: `linked${fetched.ext}`,
        contentType: fetched.contentType,
        sizeBytes: fetched.buffer.length,
        sourceUrl: url,
        parentAttachmentId: attachment.id,
      });
    }

    const buffer = await storage.get(linkedAttachment.storageRef);
    const pages = await transcribePages(buffer, linkedAttachment.originalFilename, linkedAttachment.id);
    for (const page of pages) {
      pageTexts.push(`[linked from ${attachment.originalFilename || 'attachment'} - ${url} - page ${page.pageNumber}]\n${page.text}`);
    }
  }

  return pageTexts;
}

async function transcribeAttachment(attachment, storage) {
  const buffer = await storage.get(attachment.storageRef);
  const pages = await transcribePages(buffer, attachment.originalFilename, attachment.id);
  const pageTexts = pages.map((page) => `[${attachment.originalFilename || 'attachment'} - page ${page.pageNumber}]\n${page.text}`);
  pageTexts.push(...(await transcribeLinkedDocuments(attachment, buffer, storage)));
  return pageTexts;
}

/**
 * Deterministic backstop for a confirmed reliability gap: the model doesn't consistently
 * follow synthesize.md's "null when there's nothing to compare" rule for
 * identity_consistency — verified against real data (complete/1: both
 * invoices.items[].hospital_or_clinic_name came back null, yet invoice_provider_consistent
 * still came back false, firing a false "Incorrect voucher(s)"). Whether the fields a
 * given identity_consistency value is comparing are null is directly checkable in code
 * with zero ambiguity — it doesn't need LLM judgment at all, only the actual
 * script-crossing name/place comparison does. This runs unconditionally on every result,
 * overriding the LLM's answer only when there was structurally nothing for it to compare.
 */
function normalizeIdentityConsistency(fields) {
  const consistency = fields.identity_consistency || {};

  const canComparePatientName = fields.claimant?.claimant_name != null && fields.medical_record?.patient_name != null;

  const canCompareMedicalRecordProvider =
    (fields.medical?.doctor_name != null || fields.medical?.hospital_or_clinic_name != null) &&
    (fields.medical_record?.doctor_name != null || fields.medical_record?.hospital_or_clinic_name != null);

  const canCompareBankHolder = fields.claimant?.claimant_name != null && fields.bank?.bank_account_name != null;

  return {
    ...fields,
    identity_consistency: {
      ...consistency,
      patient_name_consistent: canComparePatientName ? consistency.patient_name_consistent : null,
      medical_record_provider_consistent: canCompareMedicalRecordProvider ? consistency.medical_record_provider_consistent : null,
      bank_account_holder_consistent: canCompareBankHolder ? consistency.bank_account_holder_consistent : null,
    },
  };
}

/**
 * Deterministic guard on top of synthesize.md's own "collapse duplicate-signature entries"
 * instruction — that instruction alone has, verified twice now against the same real case
 * (complete/1, Hlaing Myo Oo), not reliably stopped the model from reporting one physical
 * voucher as two invoices.items[] entries with every field identical (subtotal, legible,
 * has_itemized_breakdown, has_clinic_stamp_or_doctor_signature, has_vitamin_or_supplement,
 * voucher_type). Two genuinely separate physical vouchers sharing an identical value on
 * every one of those fields isn't a plausible coincidence, so this collapses them in code
 * rather than continuing to rely on prompt compliance alone — this directly affects
 * downstream amount checks (document-checking's VOUCHER_AMOUNT_MISMATCH) and claim payload
 * construction (ias-claim-preparation would otherwise double the real claim amount).
 */
function dedupeInvoiceItems(fields) {
  const items = fields.invoices?.items;
  if (!Array.isArray(items) || items.length < 2) return fields;

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const fingerprint = JSON.stringify({
      subtotal: item.subtotal,
      legible: item.legible,
      has_itemized_breakdown: item.has_itemized_breakdown,
      has_clinic_stamp_or_doctor_signature: item.has_clinic_stamp_or_doctor_signature,
      has_vitamin_or_supplement: item.has_vitamin_or_supplement,
      voucher_type: item.voucher_type,
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(item);
  }

  if (deduped.length === items.length) return fields;
  return { ...fields, invoices: { ...fields.invoices, items: deduped } };
}

/**
 * Day 1: exactly one enabled route, so its extraction_schema is used regardless of the
 * final route decision (a "fallback" result just comes back all-null, which the schema
 * already permits). This stops being valid once a second route exists — at that point
 * the schema needs to vary per candidate route, not be fixed to routes[0].
 */
function buildResponseSchema(routes) {
  return {
    type: 'object',
    required: ['route', 'confidence', 'reason', 'extracted_fields'],
    properties: {
      route: { enum: [...routes.map((r) => r.routeKey), 'fallback'] },
      confidence: { type: 'number' },
      reason: { type: 'string' },
      extracted_fields: routes[0].extractionSchema,
    },
  };
}

async function recognizeCase(caseRecord, routes) {
  const storage = getStorageAdapter();
  const attachments = await gatherAttachments(caseRecord.id);

  if (attachments.length === 0) {
    return { caseId: caseRecord.id, skipped: true, reason: 'no_attachments' };
  }

  const transcriptChunks = [];
  for (const attachment of attachments) {
    transcriptChunks.push(...(await transcribeAttachment(attachment, storage)));
  }

  // Inbound only — email-sender's own outbound replies (canned "Incorrect bank details...
  // please resubmit" boilerplate, etc.) must never feed back into extraction as if they
  // were claimant-provided content. This is reachable in practice, not just theoretical:
  // email-intake resets Case.currentStatus back to READY_FOR_DOCUMENT_READING whenever a
  // new inbound message brings new attachments, regardless of the case's current status —
  // so a customer replying to a MISSING_DOCUMENTS email re-triggers this exact query on a
  // thread that already contains our own prior reply.
  const emailMessages = await EmailMessage.findAll({
    where: { direction: 'inbound' },
    include: [{ model: EmailThread, where: { caseId: caseRecord.id } }],
  });
  const emailContext = emailMessages.map((m) => `Subject: ${m.subject || ''}\nBody: ${m.bodyText || ''}`).join('\n---\n');

  const routeList = routes
    .map((r) => `- ${r.routeKey}: ${r.label} (insurer=${r.insurer}, claim_type=${r.claimType})`)
    .join('\n');

  const responseSchema = buildResponseSchema(routes);

  const userText = [
    'Available routes:',
    routeList,
    '',
    'Email content:',
    emailContext || '(no email body text)',
    '',
    'Page transcripts:',
    transcriptChunks.join('\n\n'),
  ].join('\n');

  const parsed = await synthesizeJson({ systemPrompt: SYNTHESIZE_SYSTEM_PROMPT, userText, jsonSchema: responseSchema });

  const validate = ajv.compile(responseSchema);
  if (!validate(parsed)) {
    return {
      caseId: caseRecord.id,
      outcome: 'MANUAL_REVIEW',
      reasonCode: 'SCHEMA_VALIDATION_FAILED',
      message: ajv.errorsText(validate.errors),
      extractedFields: null,
    };
  }

  const matchedRoute = routes.find((r) => r.routeKey === parsed.route);
  let outcome;
  let recognizedType = null;
  let reasonCode = null;

  if (matchedRoute && parsed.confidence >= config.claimRecognition.confidenceThreshold) {
    outcome = 'RECOGNIZED';
    recognizedType = matchedRoute.routeKey;
  } else if (matchedRoute) {
    outcome = 'MANUAL_REVIEW';
    reasonCode = 'LOW_CONFIDENCE';
  } else {
    outcome = 'NOT_RECOGNIZED';
    reasonCode = 'NO_ROUTE_MATCH';
  }

  const extractedFields = parsed.extracted_fields
    ? normalizeIdentityConsistency(dedupeInvoiceItems(parsed.extracted_fields))
    : parsed.extracted_fields;

  return { caseId: caseRecord.id, outcome, recognizedType, reasonCode, message: parsed.reason, extractedFields };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      { currentStatus: outcome.outcome, recognizedType: outcome.recognizedType, extractedFields: outcome.extractedFields },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: outcome.outcome,
      reasonCode: outcome.reasonCode,
      message: outcome.message,
    });
  });
}

async function run() {
  const routes = await getEnabledRoutes();
  if (routes.length === 0) {
    return { processed: 0, errors: [{ caseId: null, error: 'No enabled claim routes configured (ulink_claim_routes)' }] };
  }

  const cases = await Case.findAll({
    where: { currentStatus: 'READY_FOR_DOCUMENT_READING' },
    limit: config.claimRecognition.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = await recognizeCase(caseRecord, routes);
      if (outcome.skipped) {
        results.push({ caseId: outcome.caseId, ok: true, skipped: true, reason: outcome.reason });
        continue;
      }
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true, outcome: outcome.outcome });
    } catch (error) {
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, recognizeCase };
