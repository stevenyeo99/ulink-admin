const crypto = require('crypto');
const { EmailThread, EmailMessage, EmailAttachment, ApiCaseStep } = require('../../db/models');
const config = require('../../config');
const { getStorageAdapter } = require('../../storage');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { getSettings } = require('../settings/settings');
const { prepareUpload, saveUpload, UploadRefused, UPLOADABLE_STATUSES } = require('../case-upload/upload');

// api-reply-intake: API case workflow, member replies (docs/imp/CR/SYSTEM_6/freshdesk/API_MEMBER_REPLY_PLAN.md Phase 1).
//
//   input:  { 'api-reply-intake': its own previous output, if any }  — what earlier rounds handled
//   output: { handledMessageIds, newMessageIds, attachmentIds, newAttachmentIds, attachmentHashes, refused?, email? }
//
// email-intake (shared, unchanged) reads the inbox and stores a reply on the case whose thread it
// answers — for an API case, the thread api-email-sender started. This job then decides what the reply
// means for the API workflow.
//
// A reply with new files is a case-page upload made by the member: the same checks, one merged PDF (origin UPLOAD),
// API_UPLOAD_RECEIVED, and on to the IAS console like a person's upload. Not marked for the review lane: it waits for
// the normal run (owner decision 4). Files the upload refuses (a Word file, too many, too big): the case keeps waiting
// and the team is emailed to handle the reply.
//
// Works over long threads: every round's handled message ids are carried forward, so each reply is
// taken exactly once (S20), and an attachment whose content was already received (customers often
// re-attach the same files) is not taken again (S21). attachmentIds: the reply files of cases read before replies
// became uploads — api-claim-recognition still reads them, so they are carried forward unchanged, never added to.

const JOB = 'api-reply-intake';
// Waiting on the customer's documents: a claim revised with suspense, or no console images at all.
const REMINDER_STATUSES = ['API_CLAIM_SUSPENDED', 'API_NO_DOCUMENTS'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Owner decision 5: only replies after the system first asked the member for documents. With the switch off the system
// never asks, so a reply to a person's own email is left to that person, also after the switch goes on.
async function firstMemberEmailAt(caseId) {
  const sent = await ApiCaseStep.findAll({ where: { caseId, job: 'api-email-sender', status: 'DONE' }, order: [['createdAt', 'ASC']] });
  return sent.find((step) => step.input?.email?.taskType === 'MISSING_DOCUMENTS' && step.output?.messageId)?.createdAt || null;
}

async function newReplies(caseId, handled, since) {
  const threads = await EmailThread.findAll({ where: { caseId }, attributes: ['id'] });
  if (threads.length === 0) return [];
  const replies = await EmailMessage.findAll({
    where: { threadId: threads.map((t) => t.id), direction: 'inbound' },
    order: [['receivedAt', 'ASC']],
  });
  return replies.filter((m) => !handled.has(m.id) && new Date(m.receivedAt) > new Date(since));
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
  const since = await firstMemberEmailAt(caseRecord.id);
  if (!since) return { wait: true, output: { reason: 'The system has not emailed the member' } };
  const replies = await newReplies(caseRecord.id, handled, since);
  if (replies.length === 0) return { wait: true, output: { reason: 'No new reply yet' } };

  const storage = getStorageAdapter();
  const previousHashes = previous.attachmentHashes || {};
  const hashes = { ...previousHashes }; // content hash → attachment id
  const files = [];
  const attachments = await EmailAttachment.findAll({
    where: { messageId: replies.map((m) => m.id), parentAttachmentId: null },
    order: [['createdAt', 'ASC']],
  });
  for (const attachment of attachments) {
    const bytes = await storage.get(attachment.storageRef);
    const hash = sha256(bytes);
    if (hashes[hash]) continue;
    hashes[hash] = attachment.id;
    files.push({ id: attachment.id, filename: attachment.originalFilename, contentType: attachment.contentType, bytes });
  }

  const latest = replies[replies.length - 1];
  const output = {
    handledMessageIds: [...handled, ...replies.map((m) => m.id)],
    newMessageIds: replies.map((m) => m.id),
    attachmentIds: previous.attachmentIds || [],
    newAttachmentIds: files.map((f) => f.id),
    attachmentHashes: hashes,
  };

  if (files.length === 0) {
    // Nothing new to read: stay waiting, remind the member if documents are missing.
    return {
      output: { ...output, email: await reminderFor(caseRecord, latest.id) },
      nextStatus: caseRecord.currentStatus,
      message: `${replies.length} member reply(ies) without new attachments; still waiting`,
    };
  }

  let upload;
  try {
    upload = await prepareUpload(caseRecord, files);
  } catch (error) {
    // Server set-up or storage: a technical error, retried next run (the reply isn't marked handled).
    if (!(error instanceof UploadRefused) || error.status >= 500) throw error;
    return {
      output: {
        ...output,
        // Not taken: the same files sent again (alone, or with the wrong file left out) are tried again.
        attachmentHashes: previousHashes,
        refused: error.message,
        email: {
          taskType: 'MEMBER_REPLY_REFUSED',
          audience: 'internal',
          payload: { caseId: caseRecord.id, reason: error.message },
          dedupeKey: `reply-refused:${latest.id}`,
        },
      },
      nextStatus: caseRecord.currentStatus,
      message: `Member reply not uploaded: ${error.message} The team is emailed; a person handles the reply`,
    };
  }
  const { names, pageCount } = upload;
  return {
    output,
    nextStatus: 'API_UPLOAD_RECEIVED',
    message: `Member replied by email with ${names.join(', ')} (${pageCount} page${pageCount === 1 ? '' : 's'}); read and checked next, then sent to the IAS console`,
    save: (transaction) => saveUpload(caseRecord, upload, { username: 'member', comment: `Member reply by email (${latest.fromAddr || 'unknown sender'})`, transaction }),
  };
}

const job = {
  name: JOB,
  // The statuses a case-page upload is taken at.
  inputStatus: UPLOADABLE_STATUSES,
  inputs: [],
  optionalInputs: [JOB],
  batchLimit: config.apiEmail.batchLimit,
  process: processCase,
};

// Replies only come from the mailbox: with it switched off (System settings) or not set up, there is nothing to take, so
// the pipeline skips this step too — SYSTEM_4 API go-live without an inbox (same reason as email-intake). With the
// missing-documents email switched off, ULINK handles the member itself (owner decision 1: one switch, both directions).
const { notConfiguredReason: mailboxNotConfigured } = require('../email-intake/service');

async function notConfiguredReason() {
  if (!(await getSettings()).apiSendMissingDocumentsEmail) return 'member replies left to ULINK (missing-documents email switched off, System settings)';
  return mailboxNotConfigured();
}

module.exports = { run: () => runApiJob(job), job, notConfiguredReason };
