const crypto = require('crypto');
const { EmailThread, EmailMessage, EmailAttachment, ApiCaseStep } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');

// api-reply-intake: API case workflow, customer replies (docs/imp/day1/api-case-workflow.md 7.2).
//
//   input:  { 'api-reply-intake': its own previous output, if any }  — what earlier rounds handled
//   output: { handledMessageIds, newMessageIds, attachmentIds, newAttachmentIds, attachmentHashes, email? }
//
// email-intake (shared, unchanged) reads the inbox and stores a reply on the case whose thread it
// answers — for an API case, the thread api-email-sender started. That is how a reply is known to
// belong to an API case: the thread's case has source='API'. This job then decides what the reply
// means for the API workflow; email-intake's own reprocessing only knows email statuses, so it
// never moves an API case.
//
// Works over long threads: every round's handled message ids are carried forward, so each reply is
// taken exactly once (S20), and an attachment whose content was already received (customers often
// re-attach the same files) is not taken again (S21).

const JOB = 'api-reply-intake';
// Waiting on the customer's documents: a claim revised with suspense, or no console images at all.
const REMINDER_STATUSES = ['API_CLAIM_SUSPENDED', 'API_NO_DOCUMENTS'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function newReplies(caseId, handled) {
  const threads = await EmailThread.findAll({ where: { caseId }, attributes: ['id'] });
  if (threads.length === 0) return [];
  const replies = await EmailMessage.findAll({
    where: { threadId: threads.map((t) => t.id), direction: 'inbound' },
    order: [['receivedAt', 'ASC']],
  });
  return replies.filter((m) => !handled.has(m.id));
}

// Same as email cases (email-intake's queueNoAttachmentReminder): a reply that brings nothing new
// while documents are missing gets the last missing-documents list again, once per reply.
async function reminderFor(caseRecord, replyId) {
  if (!REMINDER_STATUSES.includes(caseRecord.currentStatus)) return null;
  const asked = await ApiCaseStep.findAll({
    where: { caseId: caseRecord.id, job: ['api-document-checking', 'api-material-download', JOB], status: 'DONE' },
    order: [['createdAt', 'DESC']],
  });
  const last = asked.find((step) => step.output?.email?.taskType === 'MISSING_DOCUMENTS');
  if (!last) return null;
  return { taskType: 'MISSING_DOCUMENTS', audience: 'customer', payload: last.output.email.payload, dedupeKey: `reply:${replyId}` };
}

async function processCase({ caseRecord, input }) {
  const previous = input[JOB] || {};
  const handled = new Set(previous.handledMessageIds || []);
  const replies = await newReplies(caseRecord.id, handled);
  if (replies.length === 0) return { wait: true, output: { reason: 'No new reply yet' } };

  const storage = getStorageAdapter();
  const hashes = { ...(previous.attachmentHashes || {}) }; // content hash → attachment id
  const newAttachmentIds = [];
  const attachments = await EmailAttachment.findAll({
    where: { messageId: replies.map((m) => m.id), parentAttachmentId: null },
    order: [['createdAt', 'ASC']],
  });
  for (const attachment of attachments) {
    const hash = sha256(await storage.get(attachment.storageRef));
    if (hashes[hash]) continue;
    hashes[hash] = attachment.id;
    newAttachmentIds.push(attachment.id);
  }

  const output = {
    handledMessageIds: [...handled, ...replies.map((m) => m.id)],
    newMessageIds: replies.map((m) => m.id),
    attachmentIds: [...(previous.attachmentIds || []), ...newAttachmentIds],
    newAttachmentIds,
    attachmentHashes: hashes,
  };

  if (newAttachmentIds.length > 0) {
    return {
      output,
      nextStatus: 'API_REPLY_RECEIVED',
      message: `${replies.length} customer reply(ies) with ${newAttachmentIds.length} new attachment(s); reading the documents again`,
    };
  }
  // Nothing new to read: stay waiting, remind the customer if documents are missing.
  return {
    output: { ...output, email: await reminderFor(caseRecord, replies[replies.length - 1].id) },
    nextStatus: caseRecord.currentStatus,
    message: `${replies.length} customer reply(ies) without new attachments; still waiting`,
  };
}

const job = {
  name: JOB,
  // API_INCOMPLETE isn't a waiting status any more: it goes on to preparation and a suspended revision.
  inputStatus: ['API_CLAIM_SUSPENDED', 'API_MEMBER_REVIEW_REQUIRED', 'API_NO_DOCUMENTS'],
  inputs: [],
  optionalInputs: [JOB],
  batchLimit: config.apiEmail.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
