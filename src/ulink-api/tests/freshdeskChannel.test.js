// channels/freshdeskChannel.js: each ticket's first message and each member reply becomes one Submission.
jest.mock('../config', () => ({ freshdesk: { domain: 'x.freshdesk.com', apiKey: 'k' } }));
jest.mock('../db/models', () => ({ EmailMessage: { findAll: jest.fn(async () => []) } }));
const { EmailMessage } = require('../db/models');
const { fetchNewSubmissions } = require('../channels/freshdeskChannel');

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
