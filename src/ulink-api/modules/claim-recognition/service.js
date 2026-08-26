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
const { queueDedupedTask } = require('../shared/emailTaskQueue');

const BLOCK_NAME = 'claim-recognition';
const ajv = new Ajv({ allErrors: true });

const TRANSCRIBE_INSTRUCTION = fs.readFileSync(path.join(__dirname, 'prompts', 'transcribe-page.md'), 'utf8');
const SYNTHESIZE_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'synthesize.md'), 'utf8');
const MEDICAL_RECORD_FALLBACK_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'medical-record-fallback.md'), 'utf8');

// The AYA Sompo eclaim template's own fixed label text for this section — verified present
// verbatim in real sample data both as "Medical Record Photos" (a heading directly above an
// embedded photo — complete/1, complete/2) and as "Medical Records" (a field label pointing
// at an external link instead — incomplete/jd2). Matches both; see
// findMedicalRecordFallbackChunk below for how the two are told apart.
const MEDICAL_RECORD_HEADING_PATTERN = /medical\s+records?(?:\s+photos)?/i;

// A linked-document chunk looks like "[linked from <filename> - <url> - page N]\n...".
const LINKED_CHUNK_PATTERN = /^\[linked from (.+?) - https?:\/\//;
// A top-level attachment page chunk looks like "[<filename> - page N]\n...". Checked only
// after LINKED_CHUNK_PATTERN fails to match, since a linked chunk's own label also contains
// " - page N]" further along and would otherwise be misread as an "own page" chunk.
const OWN_PAGE_CHUNK_PATTERN = /^\[(.+?) - page \d+\]/;

const MEDICAL_RECORD_FALLBACK_SCHEMA = {
  type: 'object',
  required: ['present', 'legible', 'patient_name', 'doctor_name', 'hospital_or_clinic_name', 'date'],
  properties: {
    present: { type: 'boolean' },
    legible: { type: ['boolean', 'null'] },
    patient_name: { type: ['string', 'null'] },
    doctor_name: { type: ['string', 'null'] },
    hospital_or_clinic_name: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
  },
};

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

  const canCompareDelegationPayee =
    fields.delegation_letter?.present === true && fields.delegation_letter?.authorized_payee_name != null && fields.bank?.bank_account_name != null;

  return {
    ...fields,
    identity_consistency: {
      ...consistency,
      patient_name_consistent: canComparePatientName ? consistency.patient_name_consistent : null,
      medical_record_provider_consistent: canCompareMedicalRecordProvider ? consistency.medical_record_provider_consistent : null,
      bank_account_holder_consistent: canCompareBankHolder ? consistency.bank_account_holder_consistent : null,
      delegation_letter_authorizes_payee: canCompareDelegationPayee ? consistency.delegation_letter_authorizes_payee : null,
    },
  };
}

// U/Daw/Ko/Ma/Mg(Maung)/Saya/Sayama are virtually always titles on these forms, never a
// literal given name on their own — consistent with real data throughout this project's
// samples ("Mg Kaung Nyan Lynn", "Daw Yu Wah Khaing", etc.). English titles included for the
// same reason. One leading token only, case-insensitive.
const NAME_HONORIFIC_PATTERN = /^(u|daw|ko|ma|mg|maung|saya|sayama|dr|mr|mrs|ms)\.?\s+/i;

function stripHonorific(name) {
  const match = String(name).match(NAME_HONORIFIC_PATTERN);
  const honorific = match ? match[1].toLowerCase() : null;
  const rest = String(name)
    .replace(NAME_HONORIFIC_PATTERN, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return { honorific, rest };
}

/**
 * Deterministic backstop, same reasoning as normalizeIdentityConsistency above: the LLM's
 * own bank_account_holder_consistent judgment can come back false purely because of a
 * Burmese honorific prefix on one side (e.g. claimant "Yu Wah Khaing" vs bank account "Daw
 * Yu Wah Khaing" — same person, "Daw" is just a title, not a different payee) — verified
 * against real data 2026-08-26, demo/complete/1 (Yu Wah Khaing), where this false positive
 * wrongly triggered checkDelegationLetterRequired. Only overrides a real `false` to `true`
 * when the two names become string-IDENTICAL after stripping one leading honorific from
 * each side, AND the two sides don't carry two DIFFERENT honorifics (e.g. "U Thant" vs "Daw
 * Thant" — a differing title on both sides is a real signal of an actually different person,
 * e.g. a spouse, not just title noise, so that combination is deliberately left alone). A
 * targeted equivalence rule, not a loose/fuzzy match — can't paper over the
 * actually-different-payee case checkDelegationLetterRequired exists to catch. Never touches
 * `true` or `null` — `null` already means "can't determine" from normalizeIdentityConsistency
 * above and must stay that way.
 */
function normalizeBankAccountHolderConsistency(fields) {
  if (fields.identity_consistency?.bank_account_holder_consistent !== false) return fields;

  const claimantName = fields.claimant?.claimant_name;
  const bankAccountName = fields.bank?.bank_account_name;
  if (claimantName == null || bankAccountName == null) return fields;

  const claimant = stripHonorific(claimantName);
  const bankHolder = stripHonorific(bankAccountName);
  if (claimant.rest === '' || claimant.rest !== bankHolder.rest) return fields;
  if (claimant.honorific && bankHolder.honorific && claimant.honorific !== bankHolder.honorific) return fields;

  return {
    ...fields,
    identity_consistency: { ...fields.identity_consistency, bank_account_holder_consistent: true },
  };
}

/**
 * Deterministic backstop, same reasoning as normalizeIdentityConsistency above: verified
 * against real data (2026-08-24, incomplete/jd2 with a delegation letter attached) that the
 * model can return delegation_letter.present: false alongside legible: true and other
 * fields non-null — an internally contradictory result (nothing to judge legibility or
 * fields *of* a document that isn't there). Whether present is true is what everything else
 * on this object depends on, so force the rest to null whenever it isn't.
 */
function normalizeDelegationLetter(fields) {
  if (fields.delegation_letter?.present === true) return fields;

  return {
    ...fields,
    delegation_letter: {
      ...fields.delegation_letter,
      present: false,
      legible: null,
      delegator_name: null,
      delegator_nrc: null,
      authorized_payee_name: null,
      authorized_payee_contact: null,
    },
  };
}

// true is the strongest claim either way (a positive read confirming the thing IS there),
// while false/null both just mean "this particular read didn't confirm it" — a genuine
// duplicate-scan situation (see dedupeInvoiceItems below) means one of the two reads simply
// caught more than the other, not that the two readings disagree about reality. Preferring
// true on merge is the same "don't let a noisier read silently defeat a clearer one" logic
// synthesize.md already applies to duplicate delegation-letter scans.
function preferAffirmative(a, b) {
  if (a === true || b === true) return true;
  if (a === false || b === false) return false;
  return null;
}

function mergeInvoiceItemPair(a, b) {
  return {
    subtotal: a.subtotal,
    voucher_type: a.voucher_type,
    legible: preferAffirmative(a.legible, b.legible),
    has_itemized_breakdown: preferAffirmative(a.has_itemized_breakdown, b.has_itemized_breakdown),
    has_vitamin_or_supplement: preferAffirmative(a.has_vitamin_or_supplement, b.has_vitamin_or_supplement),
    has_clinic_stamp_or_doctor_signature: preferAffirmative(a.has_clinic_stamp_or_doctor_signature, b.has_clinic_stamp_or_doctor_signature),
  };
}

/**
 * Deterministic guard on top of synthesize.md's own "collapse duplicate-signature entries"
 * instruction — that instruction alone has, verified against the same real case (complete/1,
 * Hlaing Myo Oo) on more than one occasion, not reliably stopped the model from reporting
 * one physical voucher as two invoices.items[] entries.
 *
 * Fix 2 (2026-08-25): the original version only collapsed a pair when every field matched
 * exactly. Verified against real data that this is too strict — a second occurrence of the
 * same complete/1 voucher came back with matching subtotal/voucher_type (23000/pharmacy) but
 * disagreeing legible (true vs null) and has_clinic_stamp_or_doctor_signature (true vs
 * false), because one of the two read passes simply caught the stamp/legibility and the
 * other didn't. Grouping now keys on just subtotal + voucher_type — the two fields
 * describing what the voucher actually IS, stable across re-reads of the same physical
 * document, unlike legible/has_clinic_stamp_or_doctor_signature/has_itemized_breakdown/
 * has_vitamin_or_supplement, which are read-confidence judgments that can genuinely vary
 * between two passes over the same image. Items with a null subtotal are left ungrouped —
 * not enough signal to safely treat as a duplicate of anything.
 *
 * Two genuinely separate physical vouchers happening to share the exact same subtotal AND
 * the same voucher_type is possible but unlikely enough, relative to the confirmed real
 * failure mode above, not to be worth the added complexity of a stricter key right now.
 * This directly affects downstream amount checks (document-checking's
 * VOUCHER_AMOUNT_MISMATCH) and claim payload construction (ias-claim-preparation would
 * otherwise double the real claim amount).
 */
function dedupeInvoiceItems(fields) {
  const items = fields.invoices?.items;
  if (!Array.isArray(items) || items.length < 2) return fields;

  const groups = new Map();
  const ungrouped = [];

  for (const item of items) {
    if (item.subtotal == null) {
      ungrouped.push(item);
      continue;
    }
    const key = `${item.subtotal}|${item.voucher_type}`;
    const existing = groups.get(key);
    groups.set(key, existing ? mergeInvoiceItemPair(existing, item) : item);
  }

  const deduped = [...groups.values(), ...ungrouped];
  if (deduped.length === items.length) return fields;
  return { ...fields, invoices: { ...fields.invoices, items: deduped } };
}

function linkedChunkOrigin(chunk) {
  const match = chunk.match(LINKED_CHUNK_PATTERN);
  return match ? match[1] : null;
}

function ownPageChunkOrigin(chunk) {
  if (LINKED_CHUNK_PATTERN.test(chunk)) return null; // a linked chunk's own label also contains " - page N]"
  const match = chunk.match(OWN_PAGE_CHUNK_PATTERN);
  return match ? match[1] : null;
}

/**
 * Picks which already-computed transcript chunk to re-ask about, given the chunk where the
 * heading/label match was found. Two real shapes verified against real sample data:
 *  - Embedded photo (complete/1, complete/2): the heading ("Medical Record Photos") and the
 *    actual clinic letterhead content are on the SAME page/chunk — use it directly.
 *  - External link (incomplete/jd2): the form only has a field label ("Medical Records")
 *    plus a URL on that page — the real content is in a SEPARATE chunk produced by
 *    transcribeLinkedDocuments for that same top-level attachment. This template
 *    consistently lists the medical-record link before the bills link (verified against both
 *    real submission forms in the samples), so the first linked chunk belonging to the same
 *    originating attachment, scanning forward from the heading chunk, is the medical
 *    record's own content, not the bill's. Stops as soon as scanning reaches a different
 *    attachment entirely (no such linked chunk exists for this one) and falls back to the
 *    heading chunk itself — the embedded-photo case, unchanged from before this existed.
 */
function findMedicalRecordFallbackChunk(transcriptChunks, headingIndex) {
  const headingChunk = transcriptChunks[headingIndex];
  const originFilename = ownPageChunkOrigin(headingChunk);
  if (!originFilename) return headingChunk;

  for (let i = headingIndex + 1; i < transcriptChunks.length; i += 1) {
    const chunk = transcriptChunks[i];
    if (linkedChunkOrigin(chunk) === originFilename) return chunk;
    if (ownPageChunkOrigin(chunk) !== originFilename) break; // moved on to a different attachment
  }

  return headingChunk;
}

/**
 * Every chunk belonging to the same originating attachment as the heading chunk (own-page
 * chunks matching the same filename, plus any linked chunk for that filename), in transcript
 * order — unlike findMedicalRecordFallbackChunk's single-chunk pick, used by the
 * present-but-illegible rescue below because the missing identity info can genuinely sit on
 * a different, clearly legible page of the very same attachment rather than the one page the
 * heading itself points at. Verified against real data 2026-08-26, demo/complete/1 (Yu Wah
 * Khaing): the clinical note photo directly under "Medical Records" is illegible on its own,
 * but the very next page in that same attachment is a clean, legible patient-registration
 * page carrying the patient's name — the main synthesis call had this same page in its
 * context already and still didn't use it, so a second, narrower, name-focused ask over just
 * this attachment's own pages gets a fair second look without the rest of the claim form's
 * unrelated content competing for attention.
 */
function gatherAttachmentChunks(transcriptChunks, headingIndex) {
  const headingChunk = transcriptChunks[headingIndex];
  const originFilename = ownPageChunkOrigin(headingChunk) || linkedChunkOrigin(headingChunk);
  if (!originFilename) return [headingChunk];

  return transcriptChunks.filter(
    (chunk) => ownPageChunkOrigin(chunk) === originFilename || linkedChunkOrigin(chunk) === originFilename
  );
}

/**
 * Two rescue paths, both re-asking with a single, narrow, text-only call (cheap — no
 * re-rasterization, no new vision call) scoped to already-computed transcript chunks, not the
 * whole-case merge the main synthesis call already did:
 *
 * 1. Missing entirely (medical_record.present !== true): fallback for a confirmed false
 *    negative — the main call missed a medical record that was genuinely present (verified
 *    against real data — complete/1, Hlaing Myo Oo — a page explicitly headed "Medical Record
 *    Photos", with a legible clinic letterhead and doctor's stamp, still came back
 *    present: false). Scoped to the one chunk findMedicalRecordFallbackChunk picks.
 *
 * 2. Present but illegible (medical_record.legible === false): same idea, different gap —
 *    the record was found but a detail (typically patient_name) couldn't be read from the one
 *    page the model focused on, even though a companion page of the same attachment has it
 *    (see gatherAttachmentChunks above). Only accepted if it actually improves on the
 *    original — confirms legible AND finds a patient_name — otherwise the original illegible
 *    result is kept rather than risking a same-or-worse re-ask silently overwriting it.
 *
 * Both only trigger when the page transcripts themselves contain this template's own fixed
 * label text — a deterministic contradiction/gap, not a guess. If a rescue still can't
 * confirm a real, legible record, the original result is left as-is — no escalation path;
 * the existing INCOMPLETE/resubmit-request flow is the safety net, not a new manual-review
 * state (confirmed: no manual review at this stage of the project).
 */
async function applyMedicalRecordFallback(fields, transcriptChunks) {
  const record = fields.medical_record || {};
  const missingEntirely = record.present !== true;
  const presentButIllegible = record.present === true && record.legible === false;
  if (!missingEntirely && !presentButIllegible) return fields;

  const headingIndex = transcriptChunks.findIndex((chunk) => MEDICAL_RECORD_HEADING_PATTERN.test(chunk));
  if (headingIndex === -1) return fields;

  const userText = presentButIllegible
    ? gatherAttachmentChunks(transcriptChunks, headingIndex).join('\n\n')
    : findMedicalRecordFallbackChunk(transcriptChunks, headingIndex);

  let fallback;
  try {
    fallback = await synthesizeJson({
      systemPrompt: MEDICAL_RECORD_FALLBACK_PROMPT,
      userText,
      jsonSchema: MEDICAL_RECORD_FALLBACK_SCHEMA,
    });
  } catch {
    return fields; // fallback call itself failing is no worse than the status quo
  }

  if (presentButIllegible) {
    const improved = fallback?.present === true && fallback?.legible === true && fallback?.patient_name;
    return improved ? { ...fields, medical_record: fallback } : fields;
  }

  if (fallback?.present !== true) return fields;
  return { ...fields, medical_record: fallback };
}

/**
 * Day 1: exactly one enabled route, so its extraction_schema is used regardless of the
 * final route decision (a "fallback" result just comes back all-null, which the schema
 * already permits). This stops being valid once a second route exists — at that point
 * the schema needs to vary per candidate route, not be fixed to routes[0].
 */
// `reason` is ordered before `route`/`confidence` deliberately, not just alphabetically —
// verified against real data (2026-08-24, incomplete/jd2 with a delegation letter
// attached): with `route` first, the model would sometimes reason its way to the correct
// conclusion inside `reason`'s own text ("...Therefore, the correct route is
// ayas_member_claim") while `route` itself still held an earlier, already-committed wrong
// value (`fallback`) from before that reasoning happened — a self-correction in the prose
// that never propagated back to the structured field next to it. Putting `reason` first
// makes the model write out its evidence/reasoning before it has to commit to `route`, so
// the committed value is consistent with the conclusion instead of preceding it.
function buildResponseSchema(routes) {
  return {
    type: 'object',
    required: ['reason', 'route', 'confidence', 'extracted_fields'],
    properties: {
      reason: { type: 'string' },
      route: { enum: [...routes.map((r) => r.routeKey), 'fallback'] },
      confidence: { type: 'number' },
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

  let extractedFields = parsed.extracted_fields
    ? normalizeBankAccountHolderConsistency(normalizeIdentityConsistency(normalizeDelegationLetter(dedupeInvoiceItems(parsed.extracted_fields))))
    : parsed.extracted_fields;

  if (extractedFields) {
    extractedFields = await applyMedicalRecordFallback(extractedFields, transcriptChunks);
  }

  return { caseId: caseRecord.id, outcome, recognizedType, reasonCode, message: parsed.reason, extractedFields };
}

// Deliberately does NOT fire for MANUAL_REVIEW — that outcome means a route DID match
// (just at low confidence, or a schema-validation failure), so it's still "our job", just
// needs a human look, not a "we don't handle this, contact CS" message. dedupeKey is the
// LLM's own reason text: a genuinely different resubmission (different content) gets its
// own email; an identical no-op reprocess doesn't re-send.
async function queueSubmissionNotRecognizedEmail(transaction, caseId, reason) {
  await queueDedupedTask(transaction, { caseId, taskType: 'SUBMISSION_NOT_RECOGNIZED', dedupeKey: reason || null, payload: {} });
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

    if (outcome.outcome === 'NOT_RECOGNIZED') {
      await queueSubmissionNotRecognizedEmail(transaction, caseRecord.id, outcome.message);
    }
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
