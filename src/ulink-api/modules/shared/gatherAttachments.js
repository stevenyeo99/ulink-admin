const { EmailThread, EmailMessage } = require('../../db/models');

/**
 * Every attachment across every INBOUND message in the case's thread(s) — a case can have
 * more than one EmailMessage by the time this runs (e.g. a follow-up email adding another
 * attachment), not just the one that first created it. Excludes outbound messages
 * (email-sender's own replies) — those never carry attachments today, but the filter is
 * explicit rather than incidental, so it stays correct if that ever changes.
 *
 * Shared by claim-recognition (transcription source) and console-upload (what actually gets
 * copied to the console's shared folder) — same "what documents does this case have" query,
 * one place to own it.
 */
async function gatherAttachments(caseId) {
  const threads = await EmailThread.findAll({
    where: { caseId },
    include: [{ model: EmailMessage, where: { direction: 'inbound' }, include: ['EmailAttachments'], required: false }],
  });

  const attachments = [];
  for (const thread of threads) {
    for (const message of thread.EmailMessages) {
      // Excludes attachments that are children of an already-included parent attachment
      // (parentAttachmentId set) — those get rediscovered and re-transcribed via the
      // owning attachment's own transcribeLinkedDocuments call (claim-recognition), not as
      // independent top-level attachments (avoids double-counting their transcript on a
      // reprocess). NOT the same thing as sourceUrl alone: a body-linked attachment (fetched
      // directly from the email body by email-intake — see modules/email-intake/service.js —
      // no parent attachment, sourceUrl set but parentAttachmentId null) has nothing to be
      // "rediscovered" from, so it must stay in this top-level list or it's silently never
      // processed at all (confirmed real, 2026-09-14: caseId f6f3514e-44c6-4096-a63b-
      // bcee41627640 and 35873542-51d4-42ec-bfa8-ce41f61f72b3 both sat at
      // READY_FOR_DOCUMENT_READING forever because this used to filter on `!a.sourceUrl`).
      attachments.push(...message.EmailAttachments.filter((a) => !a.parentAttachmentId));
    }
  }
  return attachments;
}

module.exports = { gatherAttachments };
