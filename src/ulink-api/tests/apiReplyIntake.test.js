// api-reply-intake: takes each customer reply on an API case's thread exactly once across rounds,
// skips attachments whose content was already received, restarts reading on new attachments, and
// asks for a reminder when a reply brings nothing new. Models and storage are in-memory.

jest.mock('../config', () => ({ apiEmail: { batchLimit: 20 } }));
jest.mock('../storage', () => ({ getStorageAdapter: () => ({ get: jest.fn(async (ref) => Buffer.from(`content:${ref.split('#')[0]}`)) }) }));
jest.mock('../db/models', () => {
  const state = { messages: [], attachments: [], steps: [] };
  return {
    state,
    EmailThread: { findAll: jest.fn(async ({ where }) => (where.caseId === 'case-1' ? [{ id: 'thread-1' }] : [])) },
    EmailMessage: {
      findAll: jest.fn(async ({ where }) => state.messages.filter((m) => where.threadId.includes(m.threadId) && m.direction === where.direction)),
    },
    EmailAttachment: {
      findAll: jest.fn(async ({ where }) => state.attachments.filter((a) => where.messageId.includes(a.messageId) && !a.parentAttachmentId)),
    },
    ApiCaseStep: {
      findAll: jest.fn(async ({ where }) => [...state.steps].reverse().filter((s) => where.job.includes(s.job) && s.status === where.status)),
    },
  };
});

const { state } = require('../db/models');
const { job } = require('../modules/api-reply-intake/service');

const suspended = { id: 'case-1', currentStatus: 'API_CLAIM_SUSPENDED' };
const reply = (id) => state.messages.push({ id, threadId: 'thread-1', direction: 'inbound' });
// storageRef "<content>#<n>": two attachments with the same content part are identical files.
const attach = (id, messageId, content) => state.attachments.push({ id, messageId, storageRef: `${content}#${id}`, parentAttachmentId: null });

beforeEach(() => Object.values(state).forEach((rows) => { rows.length = 0; }));

it('waits on the customer statuses and carries its own previous output forward', () => {
  expect(job).toMatchObject({
    inputStatus: ['API_CLAIM_SUSPENDED', 'API_MEMBER_REVIEW_REQUIRED', 'API_NO_DOCUMENTS'],
    inputs: [],
    optionalInputs: ['api-reply-intake'],
  });
});

it('waits while there is no new reply', async () => {
  expect(await job.process({ caseRecord: suspended, input: {} })).toMatchObject({ wait: true });
});

it('restarts reading when a reply brings new attachments', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'medical-report.pdf');

  const result = await job.process({ caseRecord: suspended, input: {} });

  expect(result).toMatchObject({
    nextStatus: 'API_REPLY_RECEIVED',
    output: { handledMessageIds: ['msg-1'], newMessageIds: ['msg-1'], attachmentIds: ['att-1'], newAttachmentIds: ['att-1'] },
  });
});

it('handles each reply once over a long thread and skips re-attached identical files', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'medical-report.pdf');
  const round1 = await job.process({ caseRecord: suspended, input: {} });

  reply('msg-2');
  attach('att-2', 'msg-2', 'medical-report.pdf'); // the same file sent again
  attach('att-3', 'msg-2', 'voucher.jpg');
  const round2 = await job.process({ caseRecord: suspended, input: { 'api-reply-intake': round1.output } });

  expect(round2).toMatchObject({
    nextStatus: 'API_REPLY_RECEIVED',
    output: { handledMessageIds: ['msg-1', 'msg-2'], newMessageIds: ['msg-2'], attachmentIds: ['att-1', 'att-3'], newAttachmentIds: ['att-3'] },
  });
  // Nothing new since round 2.
  expect(await job.process({ caseRecord: suspended, input: { 'api-reply-intake': round2.output } })).toMatchObject({ wait: true });
});

it('stays waiting and asks for the last missing-documents list again when a reply brings nothing new', async () => {
  state.steps.push({ job: 'api-document-checking', status: 'DONE', output: { email: { taskType: 'MISSING_DOCUMENTS', payload: { issues: ['No Medical Report(s)'] } } } });
  reply('msg-1');

  const result = await job.process({ caseRecord: suspended, input: {} });

  expect(result).toMatchObject({
    nextStatus: 'API_CLAIM_SUSPENDED',
    output: {
      handledMessageIds: ['msg-1'],
      email: { taskType: 'MISSING_DOCUMENTS', audience: 'customer', payload: { issues: ['No Medical Report(s)'] }, dedupeKey: 'reply:msg-1' },
    },
  });
});

it('sends no reminder for a member issue (internal matter), just records the reply', async () => {
  reply('msg-1');
  const result = await job.process({ caseRecord: { id: 'case-1', currentStatus: 'API_MEMBER_REVIEW_REQUIRED' }, input: {} });
  expect(result).toMatchObject({ nextStatus: 'API_MEMBER_REVIEW_REQUIRED', output: { handledMessageIds: ['msg-1'], email: null } });
});
