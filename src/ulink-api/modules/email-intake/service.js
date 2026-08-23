const { sequelize, Case, EmailThread, EmailMessage, EmailAttachment, CaseEvent } = require('../../db/models');
const { getStorageAdapter } = require('../../storage');
const { getChannelAdapter } = require('../../channels');
const { matchOrCreateThread } = require('./threadMatcher');

const BLOCK_NAME = 'email-intake';

// Statuses where the case is genuinely waiting on the customer (or hasn't been through any
// job yet) — a new inbound attachment here is exactly the resubmission the pipeline is
// waiting for, so it's safe to reset back to READY_FOR_DOCUMENT_READING and reprocess from
// scratch. Deliberately excludes every status from RECOGNIZED onward (DOCUMENT_CHECKED,
// MEMBER_VERIFIED, CLAIM_PAYLOAD_PREPARED, CLAIM_CREATED, CLAIM_SUBMIT_FAILED, ...) — those
// represent real progress (a real IAS member lookup, a real prepared/submitted claim
// payload), and a stray attachment-bearing reply landing on that same thread later must not
// silently wipe extractedFields and re-run everything, especially post-CLAIM_CREATED where a
// real, non-idempotent claim already exists in IAS. Use POST /api/dev/cases/reset to
// reprocess one of those manually if a case genuinely needs it.
const AWAITING_CUSTOMER_STATUSES = [
  'EMAIL_RECEIVED',
  'ATTACHMENTS_STORED',
  'READY_FOR_DOCUMENT_READING',
  'NOT_RECOGNIZED',
  'MANUAL_REVIEW',
  'INCOMPLETE',
  'MEMBER_REVIEW_REQUIRED',
];

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

function datePathSegments(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * Shards by the email's received date (not ingestion time — a delayed or
 * reprocessed run should still file under when the email actually arrived)
 * and by the DB message id (channel-agnostic, unlike the channel's own
 * externalId) so the layout stays meaningful once Freshdesk is added.
 */
function attachmentStorageKey({ caseId, messageId, receivedAt, filename, index }) {
  const safeName = String(filename || `attachment-${index}`).replace(/[^\w.-]+/g, '_');
  return `${datePathSegments(receivedAt)}/${caseId}/${messageId}/${index}-${safeName}`;
}

/**
 * Business logic only — takes the channel-agnostic Submission shape (see
 * channels/index.js) and never touches IMAP/Freshdesk-specific fields.
 */
async function persistSubmission(submission) {
  const storage = getStorageAdapter();

  return sequelize.transaction(async (transaction) => {
    // Dedupe check runs FIRST, before any thread/case matching — a case
    // reprocessed for recovery/replay must be a clean no-op, not leak an
    // orphaned Case + EmailThread every time it's re-run. matchOrCreateThread
    // unconditionally creates a new Case when it can't correlate via
    // In-Reply-To/References (true for the first email in any thread), so it
    // must never run for a submission that's already stored.
    const existing = await EmailMessage.findOne({
      where: { source: submission.source, externalId: submission.externalId },
      include: [{ model: EmailThread }],
      transaction,
    });

    if (existing) {
      return { caseId: existing.EmailThread.caseId, skipped: true };
    }

    const { threadId, caseId } = await matchOrCreateThread(transaction, {
      inReplyTo: submission.inReplyTo,
      references: submission.references,
      subjectHint: submission.subject,
      firstMessageId: submission.messageId,
    });

    const emailMessage = await EmailMessage.create(
      {
        threadId,
        source: submission.source,
        externalId: submission.externalId,
        direction: submission.direction,
        messageId: submission.messageId,
        inReplyTo: submission.inReplyTo,
        referencesHeader: submission.references,
        fromAddr: submission.from,
        toAddr: submission.to,
        ccAddr: submission.cc,
        subject: submission.subject,
        bodyText: submission.bodyText,
        status: submission.direction === 'inbound' ? 'received' : null,
        receivedAt: submission.receivedAt,
        rawSizeBytes: submission.rawSizeBytes,
      },
      { transaction }
    );

    await logEvent(transaction, { caseId, newStatus: 'EMAIL_RECEIVED', message: 'Email stored' });

    let storedCount = 0;
    for (let i = 0; i < submission.attachments.length; i += 1) {
      const attachment = submission.attachments[i];
      const key = attachmentStorageKey({
        caseId,
        messageId: emailMessage.id,
        receivedAt: submission.receivedAt,
        filename: attachment.filename,
        index: i,
      });
      const { storageRef } = await storage.put(key, attachment.content);
      await EmailAttachment.create(
        {
          messageId: emailMessage.id,
          storageRef,
          originalFilename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
        },
        { transaction }
      );
      storedCount += 1;
    }

    if (storedCount > 0) {
      const caseBeforeAttachments = await Case.findByPk(caseId, { attributes: ['currentStatus'], transaction });
      const prevStatus = caseBeforeAttachments.currentStatus;

      await logEvent(transaction, {
        caseId,
        prevStatus,
        newStatus: 'ATTACHMENTS_STORED',
        message: `${storedCount} attachment(s) stored`,
      });

      if (AWAITING_CUSTOMER_STATUSES.includes(prevStatus)) {
        await logEvent(transaction, { caseId, prevStatus: 'ATTACHMENTS_STORED', newStatus: 'READY_FOR_DOCUMENT_READING' });
        await Case.update({ currentStatus: 'READY_FOR_DOCUMENT_READING' }, { where: { id: caseId }, transaction });
      } else {
        await logEvent(transaction, {
          caseId,
          prevStatus,
          newStatus: prevStatus,
          reasonCode: 'ATTACHMENT_ON_NON_AWAITING_STATUS',
          message: `New attachment(s) arrived on a case already at '${prevStatus}' — not an awaiting-customer status, so not auto-reprocessed. Use POST /api/dev/cases/reset to reprocess manually if needed.`,
        });
      }
    }

    return { caseId, attachmentsStored: storedCount };
  });
}

async function run() {
  const results = await getChannelAdapter().fetchNewSubmissions(persistSubmission);
  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ externalId: r.externalId, error: r.error }));
  return { processed, errors };
}

module.exports = { run };
