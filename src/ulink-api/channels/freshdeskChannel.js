const fs = require('fs');
const path = require('path');
const { EmailMessage } = require('../db/models');
const config = require('../config');
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
// A new outbound ticket must have a status and a priority. Dev default: Open, Low. ULINK to confirm.
const OUTBOUND_TICKET_STATUS = 2; // Open
const OUTBOUND_TICKET_PRIORITY = 1; // Low

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

// Hand one Submission to onSubmission; a failure is reported for that message only. True when it was stored, not when
// it failed or was left for another read (leaveUnseen: the API pipeline's replies-only read).
async function submitOne(results, externalId, buildSubmission, onSubmission) {
  try {
    const outcome = await onSubmission(await buildSubmission());
    results.push({ externalId, ok: true, ...outcome });
    return !outcome?.leaveUnseen;
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

// The call's fields as JSON, or as multipart when there are attachments. Template attachments are nodemailer-shaped:
// { filename, path } or { filename, content }. An array field becomes `name[]` in the form.
async function payloadWith(fields, attachments) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
  if (!attachments?.length) return clean;
  const form = new FormData();
  for (const [name, value] of Object.entries(clean)) {
    if (Array.isArray(value)) value.forEach((v) => form.append(`${name}[]`, v));
    else form.append(name, String(value));
  }
  for (const attachment of attachments) {
    const content = attachment.content ?? (await fs.promises.readFile(attachment.path));
    form.append('attachments[]', new Blob([content]), attachment.filename || (attachment.path ? path.basename(attachment.path) : 'attachment'));
  }
  return form;
}

/**
 * Send one pipeline email through Freshdesk. Returns the message id for the sender's outbound row.
 *  - No ticket yet (first API case email, or a case that started on IMAP): a new outbound ticket -> fd-ticket:<id>.
 *    A member reply to it comes back as a conversation and joins the same case (fetchNewSubmissions).
 *  - To the ticket's requester: a reply in the ticket -> fd-conv:<id>. Freshdesk keeps the ticket subject.
 *  - To anyone else (an internal notice to Ops): a forward of the ticket -> fd-conv:<id>. A reply only ever reaches
 *    the requester, so the requester is read first and an internal notice never goes to the member.
 *    Dev default; ULINK to confirm forward or private note (freshdesk_clarification.md question 6).
 */
async function sendReply(submission, reply) {
  const body = textToHtml(reply.bodyText);
  const ccEmails = splitAddresses(reply.cc);
  const toEmails = splitAddresses(reply.to || submission.from);
  if (toEmails.length === 0) throw new Error('freshdeskChannel: no recipient for the email');

  const ticketId = ticketIdOf(submission);
  if (!ticketId) {
    const emailConfigId = Number(config.freshdesk.emailConfigId);
    if (!Number.isInteger(emailConfigId) || emailConfigId <= 0) {
      throw new Error('FRESHDESK_EMAIL_CONFIG_ID must be configured (a number) for a new outbound ticket');
    }
    const [email, ...otherTo] = toEmails;
    const ticket = await freshdesk.post(
      '/tickets/outbound_email',
      await payloadWith(
        {
          email,
          subject: reply.subject || submission.subject || '(no subject)',
          description: body,
          email_config_id: emailConfigId,
          status: OUTBOUND_TICKET_STATUS,
          priority: OUTBOUND_TICKET_PRIORITY,
          cc_emails: [...otherTo, ...ccEmails],
        },
        reply.attachments
      )
    );
    return { messageId: `fd-ticket:${ticket.id}` };
  }

  const ticket = await freshdesk.get(`/tickets/${ticketId}?include=requester`);
  const requester = (ticket.requester?.email || '').trim().toLowerCase();
  if (!requester) throw new Error(`freshdeskChannel: ticket ${ticketId} has no requester email`);
  const others = toEmails.filter((e) => e.toLowerCase() !== requester);
  // The member is a recipient: a reply, with any other recipient in CC. Nobody else: a forward, without the member's
  // own files (Ops opens the ticket for those; a third party must not get them).
  const conversation = others.length < toEmails.length
    ? await freshdesk.post(`/tickets/${ticketId}/reply`, await payloadWith({ body, cc_emails: [...others, ...ccEmails] }, reply.attachments))
    : await freshdesk.post(
      `/tickets/${ticketId}/forward`,
      await payloadWith({ body, to_emails: toEmails, cc_emails: ccEmails, include_original_attachments: false }, reply.attachments)
    );
  return { messageId: `fd-conv:${conversation.id}` };
}

module.exports = { fetchNewSubmissions, sendReply };
