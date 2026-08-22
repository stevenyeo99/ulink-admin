const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { sequelize, Case, EmailThread, EmailMessage, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { getEnabledRoutes } = require('./routeCatalog');
const { preparePageImages } = require('./rasterize');
const { transcribePage, synthesizeJson } = require('./llmClient');

const BLOCK_NAME = 'claim-recognition';
const ajv = new Ajv({ allErrors: true });

const TRANSCRIBE_INSTRUCTION = fs.readFileSync(path.join(__dirname, 'prompts', 'transcribe-page.md'), 'utf8');
const SYNTHESIZE_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'synthesize.md'), 'utf8');

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * Every attachment across every message in the case's thread(s) — a case can have more
 * than one EmailMessage by the time this runs (e.g. a follow-up email adding another
 * attachment), not just the one that first created it.
 */
async function gatherAttachments(caseId) {
  const threads = await EmailThread.findAll({
    where: { caseId },
    include: [{ model: EmailMessage, include: ['EmailAttachments'] }],
  });

  const attachments = [];
  for (const thread of threads) {
    for (const message of thread.EmailMessages) {
      attachments.push(...message.EmailAttachments);
    }
  }
  return attachments;
}

async function transcribeAttachment(attachment, storage) {
  const buffer = await storage.get(attachment.storageRef);
  const { pages, cleanup } = await preparePageImages(buffer, attachment.originalFilename, attachment.id);

  try {
    const pageTexts = [];
    for (const page of pages) {
      const imageBuffer = await fs.promises.readFile(page.filePath);
      const text = await transcribePage({ imageBuffer, instruction: TRANSCRIBE_INSTRUCTION });
      pageTexts.push(`[${attachment.originalFilename || 'attachment'} - page ${page.pageNumber}]\n${text}`);
    }
    return pageTexts;
  } finally {
    await cleanup();
  }
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

  const emailMessages = await EmailMessage.findAll({
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

  return { caseId: caseRecord.id, outcome, recognizedType, reasonCode, message: parsed.reason, extractedFields: parsed.extracted_fields };
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
