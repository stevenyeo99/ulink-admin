const fs = require('fs');
const path = require('path');
const { EmailMessage } = require('../db/models');
const freshdesk = require('./freshdeskClient');

/**
 * Freshdesk channel adapter (docs/imp/CR/SYSTEM_6/freshdesk/FRESHDESK_EMAIL_PLAN.md).
 * Each Freshdesk ticket becomes the same Submission shape as channels/imapSmtpChannel.js,
 * so no caller changes. The first message of a ticket is `ticket:<id>`; each member reply is `conv:<id>`, and its
 * references point at `fd-ticket:<ticketId>` so threadMatcher joins it to the ticket's case.
 * HTTP details (auth, retry, timeout, paging) live in channels/freshdeskClient.js.
 */

// Every run re-reads the tickets created in this window, so a ticket that failed is tried again on the next run.
// ponytail: a ticket that keeps failing for 24 hours is dropped (it shows in the job errors until then); store a
// cursor if that is not enough.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SOURCE_OUTBOUND_EMAIL = 10; // a ticket an agent (or the pipeline) started; the member did not send it

// "DRT <support@x.com>" -> "support@x.com"; a list becomes one comma-separated string, as on IMAP.
function joinAddresses(list) {
  const addresses = (list || []).map((entry) => (entry.match(/<([^>]+)>/)?.[1] || entry).trim()).filter(Boolean);
  return addresses.join(', ') || null;
}

async function downloadAttachments(attachments) {
  const files = [];
  for (const attachment of attachments || []) {
    files.push({
      filename: attachment.name || null,
      contentType: attachment.content_type || null,
      sizeBytes: attachment.size || null,
      content: await freshdesk.download(attachment.attachment_url),
    });
  }
  return files;
}

async function savedExternalIds(externalIds) {
  if (externalIds.length === 0) return new Set();
  const rows = await EmailMessage.findAll({ where: { source: 'freshdesk', externalId: externalIds }, attributes: ['externalId'] });
  return new Set(rows.map((m) => m.externalId));
}

async function ticketSubmission(ticket) {
  return {
    source: 'freshdesk',
    externalId: `ticket:${ticket.id}`,
    direction: 'inbound',
    messageId: `fd-ticket:${ticket.id}`,
    inReplyTo: null,
    references: null,
    from: ticket.requester?.email || null,
    to: joinAddresses(ticket.to_emails),
    cc: joinAddresses(ticket.cc_emails),
    subject: ticket.subject || null,
    bodyText: ticket.description_text || null,
    bodyHtml: ticket.description || null,
    receivedAt: new Date(ticket.created_at),
    rawSizeBytes: null,
    attachments: await downloadAttachments(ticket.attachments),
  };
}

async function conversationSubmission(ticket, conversation) {
  return {
    source: 'freshdesk',
    externalId: `conv:${conversation.id}`,
    direction: 'inbound',
    messageId: `fd-conv:${conversation.id}`,
    inReplyTo: `fd-ticket:${ticket.id}`,
    references: `fd-ticket:${ticket.id}`,
    from: joinAddresses([conversation.from_email]),
    to: joinAddresses(conversation.to_emails),
    cc: joinAddresses(conversation.cc_emails),
    subject: ticket.subject || null,
    bodyText: conversation.body_text || null,
    bodyHtml: conversation.body || null,
    receivedAt: new Date(conversation.created_at),
    rawSizeBytes: null,
    attachments: await downloadAttachments(conversation.attachments),
  };
}

// Hand one Submission to onSubmission; a failure is reported for that message only.
async function submitOne(results, externalId, buildSubmission, onSubmission) {
  try {
    results.push({ externalId, ok: true, ...(await onSubmission(await buildSubmission())) });
    return true;
  } catch (error) {
    results.push({ externalId, ok: false, error: error.message });
    return false;
  }
}

async function fetchNewSubmissions(onSubmission) {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const sinceParam = encodeURIComponent(since.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const tickets = await freshdesk.getAllPages(`/tickets?updated_since=${sinceParam}&order_by=updated_at&order_type=asc`);
  // One query: the tickets whose first message is already stored, inbound (Phase 1) or sent by us as a new
  // outbound ticket (Phase 4). Both carry messageId fd-ticket:<id>.
  const ticketMessageIds = tickets.map((t) => `fd-ticket:${t.id}`);
  const known = new Set(
    ticketMessageIds.length === 0
      ? []
      : (await EmailMessage.findAll({ where: { messageId: ticketMessageIds }, attributes: ['messageId'] })).map((m) => m.messageId)
  );
  const results = [];
  for (const listed of tickets) {
    const ticketExternalId = `ticket:${listed.id}`;
    // First message: only a ticket a member started inside the window. An old ticket that was only updated is not a
    // new claim, and an outbound ticket was started by us.
    const isNewTicket = listed.source !== SOURCE_OUTBOUND_EMAIL && new Date(listed.created_at) >= since;
    if (isNewTicket && !known.has(`fd-ticket:${listed.id}`)) {
      const saved = await submitOne(
        results,
        ticketExternalId,
        async () => ticketSubmission(await freshdesk.get(`/tickets/${listed.id}?include=requester`)),
        onSubmission
      );
      if (saved) known.add(`fd-ticket:${listed.id}`);
    }
    // A reply joins the case of its ticket's first message. With no stored first message (a ticket from before the
    // switch, or one that failed), it would start a new case for every reply, so it is not read.
    if (!known.has(`fd-ticket:${listed.id}`)) continue;

    // Member replies on a known ticket, old ones included.
    // ponytail: one conversations call per ticket updated in the last 24 hours, every run; store a cursor if the
    // Freshdesk rate limit becomes a problem.
    let conversations;
    try {
      conversations = await freshdesk.getAllPages(`/tickets/${listed.id}/conversations`);
    } catch (error) {
      results.push({ externalId: `${ticketExternalId}:conversations`, ok: false, error: error.message });
      continue;
    }
    const replies = conversations.filter((c) => c.incoming && !c.private && new Date(c.created_at) >= since);
    const saved = await savedExternalIds(replies.map((c) => `conv:${c.id}`));
    for (const reply of replies.filter((c) => !saved.has(`conv:${c.id}`))) {
      await submitOne(results, `conv:${reply.id}`, () => conversationSubmission(listed, reply), onSubmission);
    }
  }
  return results;
}

// "a@x.com, b@x.com" -> ["a@x.com", "b@x.com"]
function splitAddresses(value) {
  return String(value || '').split(',').map((a) => a.trim()).filter(Boolean);
}

// The ticket this reply belongs to: the inbound ticket itself (fd-ticket:<id>) or a member reply that references it.
function ticketIdOf(submission) {
  const match = `${submission.messageId || ''} ${submission.references || ''}`.match(/(?:^|\s)fd-ticket:(\d+)(?=\s|$)/);
  return match ? match[1] : null;
}

// Plain text -> HTML the way Freshdesk shows it: escaped, one <br> per line break.
function textToHtml(text) {
  const escaped = String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return escaped.replace(/\r?\n/g, '<br>');
}

// Template attachments are nodemailer-shaped: { filename, path } or { filename, content }.
async function replyForm(body, ccEmails, attachments) {
  const form = new FormData();
  form.append('body', body);
  for (const email of ccEmails) form.append('cc_emails[]', email);
  for (const attachment of attachments) {
    const content = attachment.content ?? (await fs.promises.readFile(attachment.path));
    form.append('attachments[]', new Blob([content]), attachment.filename || (attachment.path ? path.basename(attachment.path) : 'attachment'));
  }
  return form;
}

/**
 * Reply in the member's ticket. Freshdesk sends a reply only to the ticket's requester, in the same email thread, and
 * keeps the ticket's own subject (reply.subject is not used). So the requester is read first: a reply meant for
 * anyone else (an internal notice) must not go out to the member. Returns fd-conv:<id> for the sender's outbound row.
 */
async function sendReply(submission, reply) {
  const ticketId = ticketIdOf(submission);
  if (!ticketId) throw new Error('freshdeskChannel: no Freshdesk ticket to reply to (a new outbound ticket is Phase 4)');
  const ticket = await freshdesk.get(`/tickets/${ticketId}?include=requester`);
  const requester = (ticket.requester?.email || '').trim().toLowerCase();
  const to = (reply.to || submission.from || '').trim().toLowerCase();
  if (!requester || to !== requester) {
    throw new Error('freshdeskChannel: sending to an address other than the ticket requester is Phase 4 (forward)');
  }

  const body = textToHtml(reply.bodyText);
  const ccEmails = splitAddresses(reply.cc);
  const payload = reply.attachments?.length
    ? await replyForm(body, ccEmails, reply.attachments)
    : { body, ...(ccEmails.length ? { cc_emails: ccEmails } : {}) };
  const conversation = await freshdesk.post(`/tickets/${ticketId}/reply`, payload);
  return { messageId: `fd-conv:${conversation.id}` };
}

module.exports = { fetchNewSubmissions, sendReply };
