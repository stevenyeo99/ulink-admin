// channels/freshdeskChannel.js: each ticket's first message and each member reply becomes one Submission.
jest.mock('../config', () => ({ freshdesk: { domain: 'x.freshdesk.com', apiKey: 'k', emailConfigId: '39' } }));
const config = require('../config');
jest.mock('../db/models', () => ({ EmailMessage: { findAll: jest.fn(async () => []) } }));
const { EmailMessage } = require('../db/models');
const { fetchNewSubmissions, sendReply } = require('../channels/freshdeskChannel');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; EmailMessage.findAll.mockImplementation(async () => []); });

const reply = (body, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => '0' },
  json: async () => body,
  arrayBuffer: async () => Buffer.from(String(body)),
});
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const old = '2020-01-01T00:00:00Z';
const file = (id) => ({ id, name: `f${id}.pdf`, content_type: 'application/pdf', size: 3, attachment_url: `https://files/${id}` });
const ticket = {
  id: 4,
  source: 1,
  subject: 'Claim',
  description: '<div>Hi</div>',
  description_text: 'Hi',
  to_emails: ['DRT <support@x.freshdesk.com>'],
  cc_emails: [],
  created_at: recent,
  requester: { email: 'member@example.com' },
  attachments: [file(1)],
};
const memberReply = { id: 9, incoming: true, private: false, from_email: 'member@example.com', to_emails: ['DRT <support@x.freshdesk.com>'], cc_emails: [], body: '<div>More</div>', body_text: 'More', created_at: recent, attachments: [file(2)] };

// Answers by URL, so the test does not depend on call order. A 429 is answered once first.
let firstUrl;
function routeFetch(routes) {
  let throttled = false;
  global.fetch = jest.fn(async (url) => {
    if (!throttled) { throttled = true; firstUrl = url; return reply({}, 429); }
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return routes[key];
  });
}

it('saves a new ticket with its files, then the member reply with its files, threaded to the ticket', async () => {
  routeFetch({
    '/tickets?updated_since=': reply([{ ...ticket, attachments: undefined }]),
    '/tickets/4?include=requester': reply(ticket),
    '/tickets/4/conversations': reply([
      memberReply,
      { ...memberReply, id: 8, incoming: false }, // our own reply
      { ...memberReply, id: 7, private: true }, // internal note
    ]),
    'https://files/1': reply('pdf'),
    'https://files/2': reply('pdf'),
  });
  const onSubmission = jest.fn(async () => ({ caseId: 7 }));

  expect(await fetchNewSubmissions(onSubmission)).toEqual([
    { externalId: 'ticket:4', ok: true, caseId: 7 },
    { externalId: 'conv:9', ok: true, caseId: 7 },
  ]);
  const [first, second] = onSubmission.mock.calls.map(([s]) => s);
  expect(first).toMatchObject({ externalId: 'ticket:4', messageId: 'fd-ticket:4', from: 'member@example.com', to: 'support@x.freshdesk.com', cc: null, bodyText: 'Hi' });
  expect(first.attachments).toEqual([{ filename: 'f1.pdf', contentType: 'application/pdf', sizeBytes: 3, content: Buffer.from('pdf') }]);
  expect(second).toMatchObject({ externalId: 'conv:9', messageId: 'fd-conv:9', inReplyTo: 'fd-ticket:4', references: 'fd-ticket:4', from: 'member@example.com', subject: 'Claim', bodyText: 'More' });
  expect(second.attachments[0].filename).toBe('f2.pdf');
  expect(fetch.mock.calls[1][0]).toBe(firstUrl); // the 429 is retried on the same URL
  const fileCall = fetch.mock.calls.find(([url]) => url === 'https://files/1');
  expect(fileCall[1].headers).toBeUndefined(); // the signed link gets no API key
});

it('reads replies only on tickets whose first message is stored, old and outbound ones included', async () => {
  // fd-ticket:1 saved inbound, fd-ticket:2 our own outbound ticket, fd-ticket:3 an old saved ticket; ticket 6 unknown.
  EmailMessage.findAll.mockImplementation(async ({ where }) =>
    (where.messageId || []).filter((id) => ['fd-ticket:1', 'fd-ticket:2', 'fd-ticket:3'].includes(id)).map((messageId) => ({ messageId }))
  );
  routeFetch({
    '/tickets?updated_since=': reply([
      { id: 1, source: 1, subject: 'A', created_at: recent },
      { id: 2, source: 10, subject: 'B', created_at: recent },
      { id: 3, source: 1, subject: 'C', created_at: old },
      { id: 6, source: 1, subject: 'D', created_at: old }, // from before the switch: a reply would start a new case
    ]),
    '/tickets/1/conversations': reply([{ ...memberReply, id: 11, attachments: [] }]),
    '/tickets/2/conversations': reply([{ ...memberReply, id: 12, attachments: [] }]),
    '/tickets/3/conversations': reply([{ ...memberReply, id: 13, attachments: [] }, { ...memberReply, id: 14, created_at: old }]),
  });
  const onSubmission = jest.fn(async () => ({}));

  expect((await fetchNewSubmissions(onSubmission)).map((r) => r.externalId)).toEqual(['conv:11', 'conv:12', 'conv:13']);
  const urls = fetch.mock.calls.map(([url]) => url);
  expect(urls.some((url) => /\/tickets\/\d\?include/.test(url))).toBe(false);
  expect(urls.some((url) => url.includes('/tickets/6/'))).toBe(false);
  expect(urls).toContain('https://x.freshdesk.com/api/v2/tickets/3/conversations?per_page=100&page=1');
  expect(onSubmission.mock.calls[2][0]).toMatchObject({ references: 'fd-ticket:3', subject: 'C' });
});

it('reports a failed ticket and skips its replies until the next run', async () => {
  routeFetch({
    '/tickets?updated_since=': reply([{ id: 4, source: 1, created_at: recent }]),
    '/tickets/4?include=requester': reply({}, 500),
  });
  const onSubmission = jest.fn();
  expect(await fetchNewSubmissions(onSubmission)).toEqual([
    { externalId: 'ticket:4', ok: false, error: 'Freshdesk GET /tickets/4?include=requester failed with status 500' },
  ]);
  expect(fetch.mock.calls.some(([url]) => url.includes('/conversations'))).toBe(false);
  expect(onSubmission).not.toHaveBeenCalled();
});

it('reads the next page while a page is full', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, source: 1, created_at: old }));
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/conversations')) return reply([]);
    return reply(url.endsWith('page=1') ? full : []);
  });
  expect(await fetchNewSubmissions(jest.fn())).toEqual([]);
  expect(fetch.mock.calls.filter(([url]) => url.includes('updated_since')).map(([url]) => url.match(/page=(\d+)$/)[1])).toEqual(['1', '2']);
});

describe('sendReply', () => {
  const ticketSide = { from: 'member@example.com', messageId: 'fd-conv:9', references: 'fd-ticket:4' };
  // GET /tickets/4 answers with the requester; POST /reply answers with the new conversation.
  const freshdeskWith = (conversationId) => jest.fn(async (url, init) =>
    init?.method === 'POST' ? reply({ id: conversationId }) : reply({ id: 4, requester: { email: 'member@example.com' } }));

  it('replies in the ticket as escaped HTML with cc, and returns the conversation id', async () => {
    global.fetch = freshdeskWith(55);
    const result = await sendReply(ticketSide, { to: 'Member@Example.com', cc: 'ops@x.com, jd@x.com', subject: 'ignored', bodyText: 'Dear <member>\nPlease send A & B' });

    expect(result).toEqual({ messageId: 'fd-conv:55' });
    const [url, init] = fetch.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(url).toBe('https://x.freshdesk.com/api/v2/tickets/4/reply');
    expect(JSON.parse(init.body)).toEqual({ body: 'Dear &lt;member&gt;<br>Please send A &amp; B', cc_emails: ['ops@x.com', 'jd@x.com'] });
  });

  it('sends attachments as multipart, read from disk or from content', async () => {
    const file = require('path').join(require('os').tmpdir(), `fd-test-${process.pid}.pdf`);
    require('fs').writeFileSync(file, 'pdf');
    global.fetch = freshdeskWith(56);
    try {
      await sendReply({ messageId: 'fd-ticket:4' }, { to: 'member@example.com', bodyText: 'Hi', attachments: [{ filename: 'csr.pdf', path: file }, { content: Buffer.from('b') }] });
    } finally {
      require('fs').unlinkSync(file);
    }

    const init = fetch.mock.calls.find(([, i]) => i?.method === 'POST')[1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined(); // fetch sets the multipart boundary
    expect(init.body.get('body')).toBe('Hi');
    const files = init.body.getAll('attachments[]');
    expect(files.map((f) => f.name)).toEqual(['csr.pdf', 'attachment']);
    expect(await files[0].text()).toBe('pdf');
  });

  it('forwards the ticket to anyone other than the requester, and never replies to the member with it', async () => {
    global.fetch = freshdeskWith(57);
    // email-sender internal notice: to = ops, from = member
    expect(await sendReply(ticketSide, { to: 'ops@x.com', cc: 'lead@x.com', bodyText: 'Docs incomplete' })).toEqual({ messageId: 'fd-conv:57' });
    // api-email-sender internal email: no from at all
    await sendReply({ messageId: 'fd-conv:1', references: 'fd-ticket:4' }, { to: 'ops@x.com', bodyText: 'x' });
    // a CC'd person replied last: a reply would still go to the requester, so it is a forward
    await sendReply({ ...ticketSide, from: 'cc@x.com' }, { to: 'cc@x.com', bodyText: 'x' });

    const posts = fetch.mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(posts.map(([url]) => url)).toEqual(Array(3).fill('https://x.freshdesk.com/api/v2/tickets/4/forward'));
    expect(JSON.parse(posts[0][1].body)).toEqual({ body: 'Docs incomplete', to_emails: ['ops@x.com'], cc_emails: ['lead@x.com'], include_original_attachments: false });
  });

  it('replies when the member is one of several recipients, and refuses a ticket with no requester', async () => {
    global.fetch = freshdeskWith(58);
    await sendReply(ticketSide, { to: 'member@example.com, spouse@x.com', cc: 'ops@x.com', bodyText: 'x' });
    const [url, init] = fetch.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(url).toBe('https://x.freshdesk.com/api/v2/tickets/4/reply');
    expect(JSON.parse(init.body).cc_emails).toEqual(['spouse@x.com', 'ops@x.com']);

    global.fetch = jest.fn(async (u, i) => (i?.method === 'POST' ? reply({ id: 1 }) : reply({ id: 4 })));
    await expect(sendReply(ticketSide, { to: 'member@example.com', bodyText: 'x' })).rejects.toThrow('has no requester email');
    expect(fetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('starts a new outbound ticket when there is no ticket yet, with the template subject', async () => {
    global.fetch = jest.fn(async () => reply({ id: 77 }));
    const result = await sendReply({ messageId: null, references: null }, { to: 'customer@x.com, other@x.com', cc: 'ops@x.com', subject: 'Claim (Ref: T1)', bodyText: 'Hi' });

    expect(result).toEqual({ messageId: 'fd-ticket:77' });
    const [url, init] = fetch.mock.calls[0];
    expect(fetch).toHaveBeenCalledTimes(1); // no ticket to read first
    expect(url).toBe('https://x.freshdesk.com/api/v2/tickets/outbound_email');
    expect(JSON.parse(init.body)).toEqual({
      email: 'customer@x.com',
      subject: 'Claim (Ref: T1)',
      description: 'Hi',
      email_config_id: 39,
      status: 2,
      priority: 1,
      cc_emails: ['other@x.com', 'ops@x.com'],
    });
  });

  it('needs FRESHDESK_EMAIL_CONFIG_ID for a new outbound ticket', async () => {
    global.fetch = jest.fn();
    try {
      for (const value of [undefined, 'support']) {
        config.freshdesk.emailConfigId = value;
        await expect(sendReply({}, { to: 'a@x.com', bodyText: 'x' })).rejects.toThrow('FRESHDESK_EMAIL_CONFIG_ID');
      }
    } finally {
      config.freshdesk.emailConfigId = '39';
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
