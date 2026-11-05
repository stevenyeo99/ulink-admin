// api-reply-intake (API_MEMBER_REPLY_PLAN.md Phase 1): a member reply with new files is taken as a case-page upload
// (one merged PDF, API_UPLOAD_RECEIVED); each reply once across rounds; identical files not taken again; a reply with
// nothing new gets the reminder; refused files keep the case waiting and email the team; only replies after the
// system's first member email; skipped while the missing-documents email is off. Models and storage are in-memory.

jest.mock('../config', () => ({ apiEmail: { batchLimit: 20 }, clUpload: { url: 'http://cl-upload.test', apiKey: 'k' } }));
jest.mock('../storage', () => {
  const put = jest.fn(async (key) => ({ storageRef: `ref:${key}` }));
  return { put, getStorageAdapter: () => ({ put, get: jest.fn(async (ref) => Buffer.from(`content:${ref.split('#')[0]}`)) }) };
});
jest.mock('../modules/console-upload/mergePdf', () => ({ mergeToPdf: jest.fn(async (files) => ({ pdf: Buffer.from('%PDF'), pageCount: files.length, skipped: [] })) }));
jest.mock('../modules/settings/settings', () => ({ getSettings: jest.fn(async () => ({ apiSendMissingDocumentsEmail: true })) }));
jest.mock('../modules/email-intake/service', () => ({ notConfiguredReason: jest.fn(async () => null) }));
jest.mock('../db/models', () => {
  const state = { messages: [], attachments: [], steps: [], documents: [] };
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
      findAll: jest.fn(async ({ where, order }) => {
        const rows = state.steps.filter((s) => [].concat(where.job).includes(s.job) && s.status === where.status);
        return order[0][1] === 'DESC' ? [...rows].reverse() : rows;
      }),
      create: jest.fn(async (row) => state.steps.push(row)),
    },
    CaseDocument: { create: jest.fn(async (row) => { state.documents.push(row); return { id: `doc-${state.documents.length}`, ...row }; }) },
  };
});

const { state } = require('../db/models');
const { getSettings } = require('../modules/settings/settings');
const { job, notConfiguredReason } = require('../modules/api-reply-intake/service');

const suspended = { id: 'case-1', source: 'API', currentStatus: 'API_CLAIM_SUSPENDED', tpaCaseNumber: 'AYA-CL-26100012' };
const EMAILED_AT = new Date('2026-11-05T09:00:00Z');
const memberEmailSent = () => state.steps.push({
  job: 'api-email-sender', status: 'DONE', createdAt: EMAILED_AT,
  input: { email: { taskType: 'MISSING_DOCUMENTS', audience: 'customer' } }, output: { messageId: 'fd-ticket:1' },
});
const reply = (id, receivedAt = '2026-11-05T10:00:00Z') => state.messages.push({ id, threadId: 'thread-1', direction: 'inbound', receivedAt, fromAddr: 'member@test' });
// storageRef "<content>#<n>": two attachments with the same content part are identical files.
const attach = (id, messageId, filename, content = filename) => state.attachments.push({ id, messageId, originalFilename: filename, contentType: 'application/pdf', storageRef: `${content}#${id}`, parentAttachmentId: null });

beforeEach(() => {
  Object.values(state).forEach((rows) => { rows.length = 0; });
  memberEmailSent();
});

it('waits at the statuses a case-page upload is taken at, carrying its own previous output forward', () => {
  expect(job).toMatchObject({
    inputStatus: ['API_NO_DOCUMENTS', 'API_CLAIM_SUSPENDED', 'API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE'],
    inputs: [],
    optionalInputs: ['api-reply-intake'],
  });
});

it('waits while there is no new reply', async () => {
  expect(await job.process({ caseRecord: suspended, input: {} })).toMatchObject({ wait: true });
});

it('takes a reply with a PDF as an upload: API_UPLOAD_RECEIVED and one UPLOAD document, saved with the status move', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'medical-report.pdf');

  const result = await job.process({ caseRecord: suspended, input: {} });

  expect(result).toMatchObject({
    nextStatus: 'API_UPLOAD_RECEIVED',
    output: { handledMessageIds: ['msg-1'], newAttachmentIds: ['att-1'], attachmentIds: [] },
  });
  expect(state.documents).toHaveLength(0); // written only inside runApiJob's transaction
  await result.save('tx');
  expect(state.documents).toEqual([expect.objectContaining({ caseId: 'case-1', origin: 'UPLOAD', barcodeId: null })]);
  expect(state.steps.find((s) => s.job === 'case-upload')).toMatchObject({ input: { username: 'member', files: ['medical-report.pdf'] } });
});

it('handles each reply once over a long thread and skips re-attached identical files', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'medical-report.pdf');
  const round1 = await job.process({ caseRecord: suspended, input: {} });

  reply('msg-2', '2026-11-05T11:00:00Z');
  attach('att-2', 'msg-2', 'medical-report.pdf'); // the same file sent again
  attach('att-3', 'msg-2', 'voucher.pdf');
  const round2 = await job.process({ caseRecord: suspended, input: { 'api-reply-intake': round1.output } });

  expect(round2).toMatchObject({
    nextStatus: 'API_UPLOAD_RECEIVED',
    output: { handledMessageIds: ['msg-1', 'msg-2'], newMessageIds: ['msg-2'], newAttachmentIds: ['att-3'] },
  });
  expect(await job.process({ caseRecord: suspended, input: { 'api-reply-intake': round2.output } })).toMatchObject({ wait: true });
});

it('carries the reply files of cases read before replies became uploads forward, never adding to them', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'voucher.pdf');
  const result = await job.process({ caseRecord: suspended, input: { 'api-reply-intake': { attachmentIds: ['old-att'] } } });
  expect(result.output.attachmentIds).toEqual(['old-att']);
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
  expect(result.save).toBeUndefined();
});

it('a refused file keeps the case waiting, marks the reply handled and emails the team', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'report.docx');

  const result = await job.process({ caseRecord: suspended, input: {} });

  expect(result).toMatchObject({
    nextStatus: 'API_CLAIM_SUSPENDED',
    output: {
      handledMessageIds: ['msg-1'],
      refused: 'Only PDF, JPG or PNG files: report.docx.',
      email: { taskType: 'MEMBER_REPLY_REFUSED', audience: 'internal', payload: { reason: 'Only PDF, JPG or PNG files: report.docx.' }, dedupeKey: 'reply-refused:msg-1' },
    },
  });
  expect(result.save).toBeUndefined();
});

it('after a refused reply, the valid file sent again on its own is taken', async () => {
  reply('msg-1');
  attach('att-1', 'msg-1', 'claim.pdf');
  attach('att-2', 'msg-1', 'form.docx');
  const round1 = await job.process({ caseRecord: suspended, input: {} });
  expect(round1.output.refused).toBeDefined();

  reply('msg-2', '2026-11-05T11:00:00Z');
  attach('att-3', 'msg-2', 'claim.pdf'); // same content as att-1
  const round2 = await job.process({ caseRecord: suspended, input: { 'api-reply-intake': round1.output } });
  expect(round2).toMatchObject({ nextStatus: 'API_UPLOAD_RECEIVED', output: { newAttachmentIds: ['att-3'] } });
});

it('reads only replies after the system first asked the member for documents (owner decision 5)', async () => {
  reply('msg-early', '2026-11-05T08:00:00Z');
  attach('att-1', 'msg-early', 'report.pdf');
  expect(await job.process({ caseRecord: suspended, input: {} })).toMatchObject({ wait: true });

  state.steps.length = 0; // no system email to the member at all: the manual way
  reply('msg-1');
  expect(await job.process({ caseRecord: suspended, input: {} })).toMatchObject({ wait: true, output: { reason: 'The system has not emailed the member' } });
});

it('is skipped while the missing-documents email is switched off', async () => {
  expect(await notConfiguredReason()).toBeNull();
  getSettings.mockResolvedValueOnce({ apiSendMissingDocumentsEmail: false });
  expect(await notConfiguredReason()).toMatch(/switched off/);
});
