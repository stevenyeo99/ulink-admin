// channels/freshdeskChannel.js Phase 1: each ticket's first message becomes one Submission.
jest.mock('../config', () => ({ freshdesk: { domain: 'x.freshdesk.com', apiKey: 'k' } }));
jest.mock('../db/models', () => ({ EmailMessage: { findAll: jest.fn(async () => []) } }));
const { EmailMessage } = require('../db/models');
const { fetchNewSubmissions } = require('../channels/freshdeskChannel');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const reply = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => '0' }, json: async () => body });
const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
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
};

it('maps a new ticket to a Submission and retries a 429', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(reply({}, 429))
    .mockResolvedValueOnce(reply([ticket]))
    .mockResolvedValueOnce(reply(ticket));
  const onSubmission = jest.fn(async () => ({ caseId: 7 }));

  expect(await fetchNewSubmissions(onSubmission)).toEqual([{ externalId: 'ticket:4', ok: true, caseId: 7 }]);
  expect(fetch.mock.calls[1][0]).toContain('/tickets?updated_since=');
  expect(fetch.mock.calls[2][0]).toBe('https://x.freshdesk.com/api/v2/tickets/4?include=requester');
  expect(onSubmission.mock.calls[0][0]).toMatchObject({
    source: 'freshdesk',
    externalId: 'ticket:4',
    messageId: 'fd-ticket:4',
    from: 'member@example.com',
    to: 'support@x.freshdesk.com',
    cc: null,
    bodyText: 'Hi',
    receivedAt: new Date(recent),
    attachments: [],
  });
});

it('skips saved, outbound, and old tickets without a detail call, and reports a failed ticket', async () => {
  EmailMessage.findAll.mockResolvedValueOnce([{ externalId: 'ticket:1' }]);
  global.fetch = jest.fn()
    .mockResolvedValueOnce(reply([
      { id: 1, source: 1, created_at: recent }, // already saved
      { id: 2, source: 10, created_at: recent }, // outbound email, started by an agent
      { id: 3, source: 1, created_at: '2020-01-01T00:00:00Z' }, // old ticket, only updated
      { id: 4, source: 1, created_at: recent },
    ]))
    .mockResolvedValueOnce(reply({}, 500));
  const onSubmission = jest.fn();

  expect(await fetchNewSubmissions(onSubmission)).toEqual([
    { externalId: 'ticket:4', ok: false, error: 'Freshdesk GET /tickets/4?include=requester failed with status 500' },
  ]);
  expect(EmailMessage.findAll.mock.calls.at(-1)[0].where.externalId).toEqual(['ticket:1', 'ticket:4']);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onSubmission).not.toHaveBeenCalled();
});

it('reads the next page while a page is full', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, source: 1, created_at: '2020-01-01T00:00:00Z' }));
  global.fetch = jest.fn().mockResolvedValueOnce(reply(full)).mockResolvedValueOnce(reply([]));
  expect(await fetchNewSubmissions(jest.fn())).toEqual([]);
  expect(fetch.mock.calls.map(([url]) => url.match(/page=(\d+)$/)[1])).toEqual(['1', '2']);
});
