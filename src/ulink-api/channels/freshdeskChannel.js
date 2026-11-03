const config = require('../config');
const { EmailMessage } = require('../db/models');

/**
 * Freshdesk channel adapter (docs/imp/CR/SYSTEM_6/freshdesk/FRESHDESK_EMAIL_PLAN.md).
 * Each Freshdesk ticket becomes the same Submission shape as channels/imapSmtpChannel.js,
 * so no caller changes. The first message of a ticket is `ticket:<id>`; each member reply is `conv:<id>`, and its
 * references point at `fd-ticket:<ticketId>` so threadMatcher joins it to the ticket's case.
 */

// Every run re-reads the tickets created in this window, so a ticket that failed is tried again on the next run.
// ponytail: a ticket that keeps failing for 24 hours is dropped (it shows in the job errors until then); store a
// cursor if that is not enough.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MAX_429_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 30000;
const SOURCE_OUTBOUND_EMAIL = 10; // a ticket an agent (or the pipeline) started; the member did not send it

function assertFreshdeskConfigured() {
  if (!config.freshdesk.domain || !config.freshdesk.apiKey) {
    throw new Error('FRESHDESK_DOMAIN and FRESHDESK_API_KEY must be configured');
  }
}

// GET a Freshdesk API path as JSON. On 429 it waits Retry-After seconds (at most 2 minutes), then tries again.
async function request(path) {
  const url = `https://${config.freshdesk.domain}/api/v2${path}`;
  const authorization = `Basic ${Buffer.from(`${config.freshdesk.apiKey}:X`).toString('base64')}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After'), 10);
      const waitSeconds = Number.isNaN(retryAfter) ? 60 : Math.min(retryAfter, MAX_RETRY_WAIT_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`Freshdesk GET ${path} failed with status ${response.status}`);
    return response.json();
  }
}

// GET every page of a Freshdesk list path.
async function requestAllPages(path) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    rows.push(...batch);
    if (batch.length < PER_PAGE) return rows;
  }
}

// "DRT <support@x.com>" -> "support@x.com"; a list becomes one comma-separated string, as on IMAP.
function joinAddresses(list) {
  const addresses = (list || []).map((entry) => (entry.match(/<([^>]+)>/)?.[1] || entry).trim()).filter(Boolean);
  return addresses.join(', ') || null;
}

// Download each file at once: the attachment_url is a signed link that expires. It needs no API key.
async function downloadAttachments(attachments) {
  const files = [];
  for (const attachment of attachments || []) {
    const response = await fetch(attachment.attachment_url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Freshdesk attachment ${attachment.id} download failed with status ${response.status}`);
    files.push({
      filename: attachment.name || null,
      contentType: attachment.content_type || null,
      sizeBytes: attachment.size || null,
      content: Buffer.from(await response.arrayBuffer()),
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
  assertFreshdeskConfigured();
  const since = new Date(Date.now() - LOOKBACK_MS);
  const sinceParam = encodeURIComponent(since.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const tickets = await requestAllPages(`/tickets?updated_since=${sinceParam}&order_by=updated_at&order_type=asc`);
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
        async () => ticketSubmission(await request(`/tickets/${listed.id}?include=requester`)),
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
      conversations = await requestAllPages(`/tickets/${listed.id}/conversations`);
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

async function sendReply() {
  throw new Error('freshdeskChannel.sendReply is not implemented yet (Phase 3)');
}

module.exports = { fetchNewSubmissions, sendReply };
