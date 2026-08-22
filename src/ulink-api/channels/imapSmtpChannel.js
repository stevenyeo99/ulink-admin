const { simpleParser } = require('mailparser');
const { processUnseenMessages } = require('../modules/email-intake/imapClient');

/**
 * IMAP (read) side of the Day-1 demo channel — converts each raw IMAP
 * message into the channel-agnostic Submission shape (see channels/index.js)
 * before handing it to onSubmission, so callers never see IMAP-specific
 * fields (uid, envelope, mailparser output).
 */
async function fetchNewSubmissions(onSubmission) {
  const results = await processUnseenMessages(async (rawMessage) => {
    const parsed = await simpleParser(rawMessage.source);
    const envelope = rawMessage.envelope || {};
    const references = Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references || null;

    const joinAddresses = (addressObject) =>
      (addressObject?.value || []).map((entry) => entry.address).filter(Boolean).join(', ') || null;

    const submission = {
      source: 'imap',
      externalId: String(rawMessage.uid),
      direction: 'inbound',
      messageId: parsed.messageId || envelope.messageId || null,
      inReplyTo: parsed.inReplyTo || null,
      references,
      from: parsed.from?.value?.[0]?.address || null,
      to: joinAddresses(parsed.to),
      cc: joinAddresses(parsed.cc),
      subject: parsed.subject || envelope.subject || null,
      bodyText: parsed.text || null,
      receivedAt: rawMessage.internalDate || new Date(),
      rawSizeBytes: rawMessage.source ? rawMessage.source.length : null,
      attachments: (Array.isArray(parsed.attachments) ? parsed.attachments : [])
        .filter((attachment) => attachment?.content)
        .map((attachment) => ({
          filename: attachment.filename || null,
          contentType: attachment.contentType || null,
          sizeBytes: attachment.size || null,
          content: attachment.content,
        })),
    };

    return onSubmission(submission);
  });

  return results.map(({ uid, ...rest }) => ({ externalId: String(uid), ...rest }));
}

/**
 * SMTP (send) side — not implemented yet. Nothing in the current pipeline
 * drafts a reply to send (that's the demo plan's Block 13-15: missing-doc
 * drafting, manual approval, then SMTP send), so there's no caller for this
 * yet. Implement against the Submission shape below when that workflow lands.
 */
async function sendReply() {
  throw new Error('imapSmtpChannel.sendReply is not implemented yet (no drafting/approval workflow exists)');
}

module.exports = { fetchNewSubmissions, sendReply };
