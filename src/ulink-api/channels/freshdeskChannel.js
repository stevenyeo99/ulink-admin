const config = require('../config');
const { EmailMessage } = require('../db/models');

/**
 * Freshdesk channel adapter (docs/imp/CR/SYSTEM_6/freshdesk/FRESHDESK_EMAIL_PLAN.md).
 * Each Freshdesk ticket becomes the same Submission shape as channels/imapSmtpChannel.js,
 * so no caller changes. Phase 1: the first message of each ticket only.
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

// "DRT <support@x.com>" -> "support@x.com"; a list becomes one comma-separated string, as on IMAP.
function joinAddresses(list) {
  const addresses = (list || []).map((entry) => (entry.match(/<([^>]+)>/)?.[1] || entry).trim()).filter(Boolean);
  return addresses.join(', ') || null;
}

function ticketSubmission(ticket) {
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
    attachments: [], // Phase 2
  };
}

async function fetchNewSubmissions(onSubmission) {
  assertFreshdeskConfigured();
  const since = new Date(Date.now() - LOOKBACK_MS);
  const sinceParam = encodeURIComponent(since.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const results = [];
  for (let page = 1; ; page += 1) {
    const tickets = await request(
      `/tickets?updated_since=${sinceParam}&order_by=updated_at&order_type=asc&per_page=${PER_PAGE}&page=${page}`
    );
    // Only tickets a member started inside the window; an old ticket that was only updated is not a new claim.
    const ids = tickets
      .filter((t) => t.source !== SOURCE_OUTBOUND_EMAIL && new Date(t.created_at) >= since)
      .map((t) => `ticket:${t.id}`);
    // Skip tickets already saved before the detail call, so a re-read costs no extra API request.
    const saved = new Set(
      (await EmailMessage.findAll({ where: { source: 'freshdesk', externalId: ids }, attributes: ['externalId'] })).map(
        (m) => m.externalId
      )
    );
    for (const externalId of ids.filter((id) => !saved.has(id))) {
      try {
        const ticket = await request(`/tickets/${externalId.slice('ticket:'.length)}?include=requester`);
        results.push({ externalId, ok: true, ...(await onSubmission(ticketSubmission(ticket))) });
      } catch (error) {
        results.push({ externalId, ok: false, error: error.message });
      }
    }
    if (tickets.length < PER_PAGE) return results;
  }
}

async function sendReply() {
  throw new Error('freshdeskChannel.sendReply is not implemented yet (Phase 3)');
}

module.exports = { fetchNewSubmissions, sendReply };
