// email-intake thread matching: reply headers first; then (S8) a new email whose subject carries an
// API case's "(Ref: ...)" joins that case only when the sender is an address we emailed on it;
// anything else becomes a new case as before. Models are in-memory.

jest.mock('../db/models', () => {
  const state = { cases: [], threads: [], messages: [] };
  const lowerToAddr = (where) => where[Object.getOwnPropertySymbols(where)[0]]?.[0]?.logic;
  return {
    state,
    Case: {
      findOne: jest.fn(async ({ where }) => state.cases.find((c) => c.source === where.source && c.tpaCaseNumber === where.tpaCaseNumber) || null),
      create: jest.fn(async () => { const c = { id: `new-case-${state.cases.length + 1}` }; state.cases.push(c); return c; }),
    },
    EmailThread: {
      findOne: jest.fn(async ({ where }) => state.threads.find((t) => t.caseId === where.caseId) || null),
      create: jest.fn(async ({ caseId }) => { const t = { id: `new-thread-${state.threads.length + 1}`, caseId }; state.threads.push(t); return t; }),
    },
    EmailMessage: {
      findOne: jest.fn(async ({ where }) => {
        if (where.messageId) {
          const m = state.messages.find((x) => where.messageId[Object.getOwnPropertySymbols(where.messageId)[0]].includes(x.messageId));
          return m ? { EmailThread: state.threads.find((t) => t.id === m.threadId) } : null;
        }
        const addr = lowerToAddr(where);
        return state.messages.find((m) => m.threadId === where.threadId && m.direction === where.direction && m.toAddr.toLowerCase() === addr) || null;
      }),
    },
  };
});

const { state } = require('../db/models');
const { matchOrCreateThread } = require('../modules/email-intake/threadMatcher');

beforeEach(() => {
  Object.values(state).forEach((rows) => { rows.length = 0; });
  state.cases.push({ id: 'api-case', source: 'API', tpaCaseNumber: 'AYA-CL-26034880' });
  state.threads.push({ id: 'api-thread', caseId: 'api-case' });
  state.messages.push({ threadId: 'api-thread', direction: 'outbound', messageId: '<sent-1>', toAddr: 'customer@example.com' });
});

const subject = 'Here are my documents (Ref: AYA-CL-26034880)';

it('matches by reply headers first', async () => {
  const r = await matchOrCreateThread(null, { inReplyTo: '<sent-1>', subjectHint: 'Re: anything' });
  expect(r).toEqual({ threadId: 'api-thread', caseId: 'api-case', isNewCase: false });
});

it('joins the API case by subject ref when the sender is an address we emailed (any case)', async () => {
  const r = await matchOrCreateThread(null, { subjectHint: subject, from: 'Customer@Example.com' });
  expect(r).toEqual({ threadId: 'api-thread', caseId: 'api-case', isNewCase: false });
});

it('creates a new case when the ref matches but the sender does not', async () => {
  const r = await matchOrCreateThread(null, { subjectHint: subject, from: 'stranger@example.com' });
  expect(r.isNewCase).toBe(true);
});

it('creates a new case when there is no ref or it is not an API case', async () => {
  expect((await matchOrCreateThread(null, { subjectHint: 'New claim', from: 'customer@example.com' })).isNewCase).toBe(true);
  expect((await matchOrCreateThread(null, { subjectHint: '(Ref: UNKNOWN-1)', from: 'customer@example.com' })).isNewCase).toBe(true);
});
