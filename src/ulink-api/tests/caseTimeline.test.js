// Single case timeline (SYSTEM_4 E4-24, F1): case history, AI calls grouped per job run (no raw answers), "✓ Right"
// confirmations and trusted marks in one list, newest first, each with a kind for the console's filter.

jest.mock('../db/models', () => ({
  Case: { findByPk: jest.fn() },
  CaseEvent: { findAll: jest.fn(async () => []) },
  LlmCall: { findAll: jest.fn(async () => []) },
  AiFeedback: { findAll: jest.fn(async () => []) },
  ApiCaseStep: {}, CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {}, CaseClaim: {},
}));

const { Case, CaseEvent, LlmCall, AiFeedback } = require('../db/models');
const { buildTimeline } = require('../modules/case-timeline/timeline');
const { getTimeline } = require('../controllers/cases/casesController');

const at = (minute) => new Date(Date.UTC(2026, 9, 15, 8, minute));

it('merges the sources newest first, each with its kind; status codes read as their labels', () => {
  const entries = buildTimeline({
    events: [
      { blockName: 'claim-recognition', prevStatus: 'READY_FOR_DOCUMENT_READING', newStatus: 'RECOGNIZED', message: 'Read as ayas_member_claim', createdAt: at(1) },
      { blockName: 'case-review', prevStatus: 'INCOMPLETE', newStatus: 'MEMBER_VERIFIED', reasonCode: 'MANUAL_OVERRIDE', message: 'Overridden by Ann — documents fine', createdAt: at(30) },
      { blockName: 'email-sender', prevStatus: null, newStatus: 'EMAIL_SENT', createdAt: at(20) },
      { blockName: 'ias-claim-creation', prevStatus: 'MEMBER_VERIFIED', newStatus: 'CLAIM_CREATED', createdAt: at(40) },
    ],
    feedback: [
      { kind: 'confirm', label: 'NRC / passport', aiValue: '12/X(N)1', reason: 'Checked', createdBy: 'ann', createdAt: at(25) },
      { kind: 'value', label: 'Voucher 1 date', createdBy: 'ann', trusted: true, trustedBy: 'jd3', trustedAt: at(35), createdAt: at(10) },
    ],
  });
  expect(entries.map((e) => e.kind)).toEqual(['ias', 'people', 'people', 'people', 'email', 'system']);
  expect(entries[1]).toMatchObject({ what: 'Correction of Voucher 1 date marked trusted', why: "jd3 agreed with ann's correction" });
  expect(entries[2]).toMatchObject({ what: expect.stringMatching(/→/), why: 'Overridden by Ann — documents fine' });
  expect(entries[3].what).toBe('NRC / passport: AI "12/X(N)1" confirmed right');
  expect(entries[5].what).not.toMatch(/READY_FOR_DOCUMENT_READING/); // labels, not codes
  expect(entries[4].what).toBe('Email sent'); // an email event: not a case status, in words
});

it('groups AI calls per job run — one entry, not one per page; a later run is its own entry; no raw answers', () => {
  const call = (job, minute, status = 'ok', promptName = 'transcribe-page') => ({ job, promptName, status, durationMs: 9000, createdAt: at(minute), output: 'SECRET ANSWER' });
  const entries = buildTimeline({
    llmCalls: [
      call('claim-recognition', 1), call('claim-recognition', 2), call('claim-recognition', 3, 'timeout'),
      call('claim-recognition', 4, 'ok', 'extract-fields'),
      call('claim-recognition', 50), // a re-read after a reset: a new run
    ],
  });
  expect(entries).toHaveLength(2);
  expect(entries[1]).toMatchObject({ kind: 'ai', what: '4 AI calls — 1 not answered (timeout), 36 s', why: 'Prompts: transcribe-page, extract-fields' });
  expect(JSON.stringify(entries)).not.toMatch('SECRET ANSWER');
});

it('GET /api/cases/:id/timeline — 404 for an unknown case; otherwise the entries', async () => {
  const send = async () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await getTimeline({ params: { id: '6f1c0a2e-0000-4000-8000-000000000001' } }, res, jest.fn());
    return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
  };
  Case.findByPk.mockResolvedValue(null);
  expect((await send()).status).toBe(404);

  Case.findByPk.mockResolvedValue({ id: 'c1' });
  CaseEvent.findAll.mockResolvedValue([{ blockName: 'case-review', prevStatus: 'X', newStatus: 'Y', message: 'm', createdAt: at(1) }]);
  LlmCall.findAll.mockResolvedValue([]);
  AiFeedback.findAll.mockResolvedValue([]);
  expect((await send()).body.entries).toHaveLength(1);
});

describe('code review 2026-10-15', () => {
  it('a person\'s action is People whichever job wrote it (email flow: releasing the held email)', () => {
    const [entry] = buildTimeline({ events: [{ blockName: 'document-checking', prevStatus: 'DOCUMENTS_REVIEW', newStatus: 'INCOMPLETE', reasonCode: 'MISSING_DOCUMENTS_RELEASED', message: 'Sent by Ann', createdAt: at(1) }] });
    expect(entry.kind).toBe('people');
  });

  it('a re-read soon after a reset is its own run: a case-history entry between two calls ends a run', () => {
    const call = (minute) => ({ job: 'claim-recognition', promptName: 'transcribe-page', status: 'ok', durationMs: 1000, createdAt: at(minute) });
    const entries = buildTimeline({
      llmCalls: [call(1), call(2), call(6), call(7)],
      events: [{ blockName: 'dev-reset', prevStatus: 'RECOGNIZED', newStatus: 'READY_FOR_DOCUMENT_READING', reasonCode: 'MANUAL_RESET', createdAt: at(4) }],
    });
    expect(entries.filter((e) => e.kind === 'ai').map((e) => e.what)).toEqual(['2 AI calls, all answered, 2 s', '2 AI calls, all answered, 2 s']);
  });

  it('entries with the same time keep their real order (newest first)', () => {
    const same = at(5);
    const entries = buildTimeline({ events: [
      { blockName: 'email-intake', prevStatus: 'EMAIL_RECEIVED', newStatus: 'ATTACHMENTS_STORED', message: 'first', createdAt: same },
      { blockName: 'email-intake', prevStatus: 'ATTACHMENTS_STORED', newStatus: 'READY_FOR_DOCUMENT_READING', message: 'second', createdAt: same },
    ] });
    expect(entries.map((e) => e.why)).toEqual(['second', 'first']);
  });

  it('a malformed case id is a 404, not a hanging request', async () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await getTimeline({ params: { id: 'not-a-uuid' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
