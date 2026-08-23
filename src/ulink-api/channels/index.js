const config = require('../config');
const imapSmtpChannel = require('./imapSmtpChannel');
const freshdeskChannel = require('./freshdeskChannel');

/**
 * ChannelAdapter shape (all adapters must implement):
 *   fetchNewSubmissions(onSubmission: (submission: Submission) => Promise<any>)
 *     -> Promise<Array<{ externalId: string, ok: boolean, error?: string, ...onSubmission's resolved value }>>
 *   sendReply(submission: Submission, reply: { subject, bodyText, attachments? }): Promise<{ messageId: string }>
 *     submission here is the inbound Submission being replied to — its messageId/references
 *     thread the reply, and its from becomes the reply's recipient.
 *
 * Submission shape (channel-agnostic, produced by every adapter):
 *   {
 *     source: 'imap' | 'freshdesk',
 *     externalId: string,        // dedupe key within that source
 *     direction: 'inbound' | 'outbound',
 *     messageId, inReplyTo, references,  // email threading headers (null where not applicable)
 *     from, to, cc, subject, bodyText,
 *     receivedAt, rawSizeBytes,
 *     attachments: [{ filename, contentType, sizeBytes, content: Buffer }]
 *   }
 *
 * Day 1 demo runs on imap_smtp (no Freshdesk access yet). Switching to
 * Freshdesk later is a CHANNEL_DRIVER config change plus finishing
 * freshdeskChannel.js — callers (email-intake service, future reply sender)
 * never change.
 */
function getChannelAdapter() {
  switch (config.channel.driver) {
    case 'imap_smtp':
      return imapSmtpChannel;
    case 'freshdesk':
      return freshdeskChannel;
    default:
      throw new Error(`Unsupported CHANNEL_DRIVER "${config.channel.driver}" (expected "imap_smtp" or "freshdesk")`);
  }
}

module.exports = { getChannelAdapter };
