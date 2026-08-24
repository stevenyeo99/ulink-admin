const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { processUnseenMessages } = require('../modules/email-intake/imapClient');
const config = require('../config');

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

function assertSmtpConfigured() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.password) {
    throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must be configured');
  }
}

let transporter;
function getTransporter() {
  if (!transporter) {
    assertSmtpConfigured();
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: config.smtp.connectionTimeoutMs,
      greetingTimeout: config.smtp.greetingTimeoutMs,
      socketTimeout: config.smtp.socketTimeoutMs,
    });
  }
  return transporter;
}

/**
 * SMTP (send) side — replies in the same thread as the `submission` being
 * replied to (channel-agnostic Submission shape, see channels/index.js),
 * using its `messageId`/`references`/`from` for threading headers and reply
 * recipient. Returns the new outbound message's Message-ID so the caller can
 * persist it on the outbound EmailMessage row. `reply.cc` is optional — a plain
 * comma-separated address string, passed straight through to nodemailer.
 */
async function sendReply(submission, reply) {
  const references = [submission.references, submission.messageId].filter(Boolean).join(' ');

  const info = await getTransporter().sendMail({
    from: config.smtp.fromAddr,
    to: submission.from,
    cc: reply.cc || undefined,
    subject: reply.subject || (submission.subject ? `Re: ${submission.subject}` : undefined),
    text: reply.bodyText,
    inReplyTo: submission.messageId || undefined,
    references: references || undefined,
  });

  return { messageId: info.messageId };
}

module.exports = { fetchNewSubmissions, sendReply };
