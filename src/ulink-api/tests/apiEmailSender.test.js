// api-email-sender: sends what API jobs asked for with the email flow's templates, starts the
// case's thread with the first email and replies in it afterwards, puts the tpaCaseNumber in
// every subject, skips a repeat of the last email of the same type, and records failures for a
// retry. Models and the SMTP channel are in-memory; the templates are the real ones.

jest.mock('../config', () => ({
  apiEmail: { customerEmail: 'customer@test', batchLimit: 20 },
  emailSender: { internalReviewEmail: 'ops@test' },
  smtp: { fromAddr: 'claims@test' },
}));
jest.mock('../channels', () => {
  let n = 0;
  const sendReply = jest.fn(async () => ({ messageId: `<m${(n += 1)}@test>` }));
  return { sendReply, getChannelAdapter: () => ({ sendReply }) };
});
jest.mock('../db/models', () => {
  const { Sequelize } = jest.requireActual('sequelize');
  const state = { requests: [], steps: [], threads: [], messages: [], events: [] };
  const withUpdate = (row) => Object.assign(row, { update: jest.fn(async (f) => Object.assign(row, f)) });
  return {
    state,
    Sequelize,
    sequelize: { transaction: (fn) => fn({}) },
    Case: { findByPk: jest.fn(async (id) => ({ id, claimNo: '2604050015', tpaCaseNumber: 'STEVENEVERHILLC58' })) },
    ClaimRoute: { findOne: jest.fn(async () => ({ ccEmail: 'cc@test' })) },
    CaseEvent: { create: jest.fn(async (row) => state.events.push(row)) },
    EmailThread: {
      findOne: jest.fn(async ({ where }) => state.threads.find((t) => t.caseId === where.caseId) ?? null),
      create: jest.fn(async (row) => { const t = { id: `thread-${state.threads.length + 1}`, ...row }; state.threads.push(t); return t; }),
    },
    EmailMessage: {
      // Honors the conversation filter: internal = { direction, toAddr }; customer = Op.or of inbound / outbound-to-customer.
      findOne: jest.fn(async ({ where }) => {
        const or = where[Sequelize.Op.or];
        const matches = (m) => m.threadId === where.threadId && (or
          ? or.some((c) => m.direction === c.direction && (!c.toAddr || m.toAddr === c.toAddr))
          : m.direction === where.direction && m.toAddr === where.toAddr);
        return [...state.messages].reverse().find(matches) ?? null;
      }),
      create: jest.fn(async (row) => state.messages.push(row)),
    },
    ApiCaseStep: {
      // Two queries: the pending requests (job is a list of source jobs), and this job's own rows.
      findAll: jest.fn(async ({ where }) => (Array.isArray(where.job)
        ? state.requests.filter((r) => !state.steps.some((s) => s.status === 'DONE' && s.input.sourceStepId === r.id))
        : [...state.steps].reverse().filter((s) => s.caseId === where.caseId && s.job === where.job && s.status === where.status))),
      findOne: jest.fn(async ({ where }) => state.steps.find((s) => s.caseId === where.caseId && s.status === where.status) ?? null),
      create: jest.fn(async (row) => { const step = withUpdate({ ...row }); state.steps.push(step); return step; }),
    },
  };
});

const { state } = require('../db/models');
const { sendReply } = require('../channels');
const { run } = require('../modules/api-email-sender/service');

const request = (id, email) => ({ id, caseId: 'case-1', job: 'api-document-checking', status: 'DONE', output: { email } });
const missingDocs = (issues) => ({ taskType: 'MISSING_DOCUMENTS', audience: 'customer', payload: { issues }, dedupeKey: [...issues].sort().join('|') });

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(state).forEach((rows) => { rows.length = 0; });
});

it('sends the first email as a new email and starts the case thread', async () => {
  state.requests.push(request('step-1', missingDocs(['No Medical Report(s)'])));

  expect(await run()).toEqual({ sent: 1, skipped: 0, errors: [] });

  const [submission, reply] = sendReply.mock.calls[0];
  expect(submission).toEqual({ messageId: null, references: null }); // no In-Reply-To: a new email
  expect(reply).toMatchObject({ to: 'customer@test', cc: 'cc@test', subject: 'AYA Sompo claim 2604050015 — Additional documents required (Ref: STEVENEVERHILLC58)' });
  expect(reply.bodyText).toContain('- No Medical Report(s)'); // the email flow's own MISSING_DOCUMENTS template
  expect(state.threads).toEqual([expect.objectContaining({ caseId: 'case-1', firstMessageId: '<m1@test>' })]);
  expect(state.messages[0]).toMatchObject({ threadId: 'thread-1', direction: 'outbound', messageId: '<m1@test>', inReplyTo: null });
  expect(state.steps[0]).toMatchObject({ job: 'api-email-sender', status: 'DONE', input: { sourceStepId: 'step-1' }, output: { messageId: '<m1@test>' } });
});

it('replies in the same thread afterwards, and sends internal emails to the internal address', async () => {
  state.requests.push(request('step-1', missingDocs(['No Medical Report(s)'])));
  await run();
  state.requests.push({ ...request('step-2', {
    taskType: 'MEMBER_VERIFY_ISSUE', audience: 'internal', payload: { caseId: 'case-1', reasonCode: 'MEMBER_NOT_FOUND', reason: 'x' }, dedupeKey: 'MEMBER_NOT_FOUND',
  }), job: 'api-member-verification' });

  await run();

  const [submission, reply] = sendReply.mock.calls[1];
  expect(submission).toEqual({ messageId: null, references: null }); // internal side starts its own chain (S19)
  expect(reply.to).toBe('ops@test');
  expect(reply.subject).toMatch(/Member verification hold .* \(Ref: STEVENEVERHILLC58\)$/);
  expect(state.threads).toHaveLength(1);
});

it('skips an email that repeats the last one of the same type (same dedupe key)', async () => {
  state.requests.push(request('step-1', missingDocs(['No Medical Report(s)'])));
  await run();
  state.requests.push(request('step-2', missingDocs(['No Medical Report(s)'])));
  state.requests.push(request('step-3', missingDocs(['Missing voucher(s)'])));

  expect(await run()).toEqual({ sent: 1, skipped: 1, errors: [] });
  expect(sendReply).toHaveBeenCalledTimes(2);
});

it('records a failure and retries the same request next run', async () => {
  state.requests.push(request('step-1', missingDocs(['No Medical Report(s)'])));
  sendReply.mockRejectedValueOnce(new Error('SMTP down'));

  expect((await run()).errors).toEqual([{ caseId: 'case-1', sourceStepId: 'step-1', error: 'SMTP down' }]);
  expect(state.steps[0]).toMatchObject({ status: 'FAILED', error: 'SMTP down' });

  expect(await run()).toEqual({ sent: 1, skipped: 0, errors: [] });
});

it('keeps the customer chain separate from internal emails, and follows the customer reply (long thread)', async () => {
  state.requests.push(request('step-1', missingDocs(['No Medical Report(s)'])));
  await run();
  const firstCustomerEmail = state.messages[0].messageId;
  state.messages.push({ threadId: 'thread-1', direction: 'outbound', toAddr: 'ops@test', messageId: '<internal@test>' });
  state.messages.push({ threadId: 'thread-1', direction: 'inbound', fromAddr: 'customer@test', messageId: '<reply@cust>', referencesHeader: firstCustomerEmail });
  state.messages.push({ threadId: 'thread-1', direction: 'outbound', toAddr: 'ops@test', messageId: '<internal-2@test>' });
  state.requests.push(request('step-2', missingDocs(['Missing voucher(s)'])));

  await run();

  // Replies to the customer's own reply, not to the newer internal email.
  expect(sendReply.mock.calls[1][0]).toEqual({ messageId: '<reply@cust>', references: firstCustomerEmail });
});
