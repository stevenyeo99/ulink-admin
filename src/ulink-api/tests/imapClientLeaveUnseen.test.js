// IMAP: a message flagged \Seen is never read again, so a message the API pipeline's replies-only read leaves for the
// email pipeline (leaveUnseen) must stay unseen (API_MEMBER_REPLY_PLAN.md Phase 2). imapflow is replaced.

jest.mock('imapflow', () => {
  const client = {
    on: jest.fn(), connect: jest.fn(), logout: jest.fn(async () => {}),
    getMailboxLock: jest.fn(async () => ({ release: jest.fn() })),
    search: jest.fn(async () => [1, 2]),
    fetch: jest.fn(async function* fetch() { yield { uid: 1 }; yield { uid: 2 }; }),
    messageFlagsAdd: jest.fn(async () => {}),
  };
  return { client, ImapFlow: jest.fn(() => client) };
});

const config = require('../config');
const { client } = require('imapflow');
const { processUnseenMessages } = require('../modules/email-intake/imapClient');

it('flags a taken message seen, and leaves a message left for another read unseen', async () => {
  Object.assign(config.imap, { host: 'imap.test', user: 'u', password: 'p' });
  const results = await processUnseenMessages(async (m) => (m.uid === 1 ? { caseId: 'c' } : { leaveUnseen: true }));
  expect(client.messageFlagsAdd.mock.calls.map(([uid]) => uid)).toEqual([1]);
  expect(results).toHaveLength(2);
});
