// API_MEMBER_REPLY_PLAN.md Phase 2: while email cases are off, the API pipeline reads the mailbox for replies to API
// cases only. Anything else (a new claim email, a reply to an email case) is left for the email pipeline: nothing
// stored, no case, and on IMAP the message stays unseen. Models, storage and the thread matcher are in-memory.

jest.mock('../db/models', () => {
  const rows = { messages: [], events: [] };
  return {
    rows,
    sequelize: { transaction: (fn) => fn('tx') },
    Case: { findByPk: jest.fn(), update: jest.fn() },
    EmailThread: {},
    EmailMessage: { findOne: jest.fn(async () => null), create: jest.fn(async (row) => { rows.messages.push(row); return { id: 'msg-1', ...row }; }) },
    EmailAttachment: { create: jest.fn() },
    CaseEvent: { create: jest.fn(async (row) => rows.events.push(row)) },
  };
});
jest.mock('../storage', () => ({ getStorageAdapter: () => ({ put: jest.fn(async (key) => ({ storageRef: key })) }) }));
jest.mock('../modules/email-intake/threadMatcher', () => ({ matchOrCreateThread: jest.fn() }));
jest.mock('../modules/settings/settings', () => ({ getSettings: jest.fn() }));

const { rows, Case } = require('../db/models');
const { matchOrCreateThread } = require('../modules/email-intake/threadMatcher');
const { getSettings } = require('../modules/settings/settings');
const emailIntake = require('../modules/email-intake/service');
const { persistSubmission } = emailIntake;

const submission = { source: 'freshdesk', externalId: 'conv:9', direction: 'inbound', references: 'fd-ticket:4', subject: 'Re: claim', attachments: [] };

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(rows).forEach((r) => { r.length = 0; });
});

it('stores a reply that joins an API case, and never asks the matcher to make a case', async () => {
  matchOrCreateThread.mockResolvedValue({ threadId: 'thread-1', caseId: 'api-case', isNewCase: false });
  Case.findByPk.mockResolvedValue({ source: 'API', currentStatus: 'API_CLAIM_SUSPENDED' });

  expect(await persistSubmission(submission, { repliesOnly: true })).toMatchObject({ caseId: 'api-case' });
  expect(matchOrCreateThread.mock.calls[0][2]).toEqual({ create: false });
  expect(rows.messages).toHaveLength(1);
});

it('leaves a new claim email and a reply to an email case for the email pipeline', async () => {
  matchOrCreateThread.mockResolvedValueOnce(null);
  expect(await persistSubmission(submission, { repliesOnly: true })).toEqual({ skipped: 'not a reply to an API case', leaveUnseen: true });

  matchOrCreateThread.mockResolvedValueOnce({ threadId: 'thread-2', caseId: 'email-case', isNewCase: false });
  Case.findByPk.mockResolvedValueOnce({ source: 'EMAIL' });
  expect(await persistSubmission(submission, { repliesOnly: true })).toEqual({ skipped: 'not a reply to an API case', leaveUnseen: true });

  expect(rows.messages).toHaveLength(0);
  expect(rows.events).toHaveLength(0);
});

it('the email pipeline itself still makes new cases (no change there)', async () => {
  matchOrCreateThread.mockResolvedValue({ threadId: 'thread-3', caseId: 'new-case', isNewCase: true });
  Case.findByPk.mockResolvedValue({ source: 'EMAIL', currentStatus: 'EMAIL_RECEIVED' });
  await persistSubmission(submission);
  expect(matchOrCreateThread.mock.calls[0][2]).toEqual({ create: true });
  expect(rows.messages).toHaveLength(1);
});

it('the API pipeline step reads the mailbox only while email cases are off and the missing-documents email is on', async () => {
  const step = require('../modules/pipeline/service').API_STEPS.find(([name]) => name === 'api-mailbox-replies')[1];
  jest.spyOn(emailIntake, 'notConfiguredReason').mockResolvedValue(null);
  getSettings.mockResolvedValue({ apiSendMissingDocumentsEmail: true, emailCasesEnabled: false });
  expect(await step.notConfiguredReason()).toBeNull();
  getSettings.mockResolvedValue({ apiSendMissingDocumentsEmail: true, emailCasesEnabled: true });
  expect(await step.notConfiguredReason()).toMatch(/email cases on/);
  getSettings.mockResolvedValue({ apiSendMissingDocumentsEmail: false, emailCasesEnabled: false });
  expect(await step.notConfiguredReason()).toMatch(/switched off/);
});
