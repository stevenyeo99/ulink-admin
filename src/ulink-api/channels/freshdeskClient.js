const config = require('../config');

/**
 * Freshdesk API v2 client: the one place for auth, timeout, 429 retry and paging.
 * channels/freshdeskChannel.js maps tickets to Submissions on top of it; a new Freshdesk call is one line there.
 */

const PER_PAGE = 100;
const MAX_429_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 120;
const REQUEST_TIMEOUT_MS = 30000;
const POST_TIMEOUT_MS = 120000;

function isConfigured() {
  return Boolean(config.freshdesk.domain && config.freshdesk.apiKey);
}

function assertConfigured() {
  if (!isConfigured()) throw new Error('FRESHDESK_DOMAIN and FRESHDESK_API_KEY must be configured');
}

// fetch with the timeout and the 429 retry. On 429 it waits Retry-After seconds (at most 2 minutes) and tries again;
// Freshdesk did not run the call.
async function fetchWithRetry(url, init, timeoutMs) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 429 || attempt >= MAX_429_RETRIES) return response;
    const retryAfter = Number.parseInt(response.headers.get('Retry-After'), 10);
    const waitSeconds = Number.isNaN(retryAfter) ? 60 : Math.min(retryAfter, MAX_RETRY_WAIT_SECONDS);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}

// One API call. body: a plain object is sent as JSON, a FormData as multipart (for attachments).
async function call(method, path, body) {
  assertConfigured();
  const headers = { Authorization: `Basic ${Buffer.from(`${config.freshdesk.apiKey}:X`).toString('base64')}` };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  // A POST is not safe to repeat: a timeout after Freshdesk sent the reply makes the next run send it again. So it gets
  // a longer timeout, for attachment uploads.
  const response = await fetchWithRetry(
    `https://${config.freshdesk.domain}/api/v2${path}`,
    { method, headers, body: body === undefined || isForm ? body : JSON.stringify(body) },
    method === 'GET' ? REQUEST_TIMEOUT_MS : POST_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(`Freshdesk ${method} ${path} failed with status ${response.status}`);
  return response.json();
}

const get = (path) => call('GET', path);
const post = (path, body) => call('POST', path, body);

// GET every page of a Freshdesk list path.
async function getAllPages(path) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const batch = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    rows.push(...batch);
    if (batch.length < PER_PAGE) return rows;
  }
}

// Download one attachment. The attachment_url is a signed link that expires, so it gets no API key.
async function download(url) {
  const response = await fetchWithRetry(url, {}, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Freshdesk attachment download failed with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { isConfigured, get, post, getAllPages, download };
