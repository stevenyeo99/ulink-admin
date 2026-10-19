// Try again (owner, 2026-10-19): a case IAS or the console refused goes back one step on a person's button, with a
// comment — any logged-in user. The models are replaced here.

jest.mock('../db/models', () => {
  const rows = { updates: [], events: [] };
  return {
    rows,
    sequelize: { transaction: (fn) => fn('tx') },
    Case: { findByPk: jest.fn(), update: jest.fn(async (fields, opts) => { rows.updates.push({ fields, where: opts.where }); return [1]; }) },
    CaseEvent: { create: jest.fn(async (row) => rows.events.push(row)) },
    ApiCaseStep: { findAll: jest.fn(async () => []) },
  };
});

const { rows, Case, ApiCaseStep } = require('../db/models');
const { retryOptions, consoleUploadReasonOf } = require('../modules/case-retry/retry');
const { retryCase } = require('../controllers/cases/casesController');

const call = async (caseRecord, body) => {
  Case.findByPk.mockResolvedValue(caseRecord);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await retryCase({ params: { id: caseRecord.id }, body, user: { username: 'csr1', name: 'CSR' } }, res);
  return res;
};

beforeEach(() => { jest.clearAllMocks(); rows.updates.length = 0; rows.events.length = 0; });

it('offers send / prepare after an IAS refusal, upload after a console refusal, nothing elsewhere', () => {
  expect(retryOptions('API_CLAIM_REVISION_FAILED').actions.map((a) => [a.id, a.target]))
    .toEqual([['send', 'API_CLAIM_PAYLOAD_PREPARED'], ['prepare', 'API_READY_FOR_CLAIM_PREPARATION']]);
  expect(retryOptions('CLAIM_SUBMIT_FAILED').actions.map((a) => a.target)).toEqual(['CLAIM_PAYLOAD_PREPARED', 'DOCUMENTS_UPLOADED']);
  expect(retryOptions('API_CONSOLE_UPLOAD_FAILED', { consoleUploadReason: 'CONSOLE_UPLOAD_REFUSED' }).actions.map((a) => a.target)).toEqual(['API_DOCUMENTS_VERIFIED']);
  // The console took the file without a scan id: uploading again would duplicate it.
  expect(retryOptions('API_CONSOLE_UPLOAD_FAILED', { consoleUploadReason: 'CONSOLE_SCAN_ID_UNKNOWN' })).toMatchObject({ actions: [], note: expect.stringContaining('duplicate') });
  expect(retryOptions('API_CLAIM_REVISED')).toBeNull();
});

it('moves the case back one step with who and why in the history', async () => {
  const res = await call({ id: 'c1', source: 'API', currentStatus: 'API_CLAIM_REVISION_FAILED' }, { action: 'send', comment: 'Benefit head added to the plan in IAS' });
  expect(res.body).toEqual({ caseId: 'c1', previousStatus: 'API_CLAIM_REVISION_FAILED', currentStatus: 'API_CLAIM_PAYLOAD_PREPARED' });
  expect(rows.updates[0]).toMatchObject({ fields: { currentStatus: 'API_CLAIM_PAYLOAD_PREPARED' }, where: { id: 'c1', currentStatus: 'API_CLAIM_REVISION_FAILED' } });
  expect(rows.events[0]).toMatchObject({ reasonCode: 'MANUAL_RETRY', message: 'Send again by CSR (csr1) — comment: Benefit head added to the plan in IAS' });
});

it('needs a comment and a possible action; a refused upload only when the console refused it', async () => {
  expect((await call({ id: 'c1', source: 'API', currentStatus: 'API_CLAIM_REVISION_FAILED' }, { action: 'send' })).statusCode).toBe(400);
  expect((await call({ id: 'c1', source: 'API', currentStatus: 'API_CLAIM_REVISED' }, { action: 'send', comment: 'again' })).statusCode).toBe(400);
  ApiCaseStep.findAll.mockResolvedValueOnce([{ job: 'api-console-upload', status: 'DONE', output: { reasonCode: 'CONSOLE_SCAN_ID_UNKNOWN' } }]);
  expect((await call({ id: 'c1', source: 'API', currentStatus: 'API_CONSOLE_UPLOAD_FAILED' }, { action: 'upload', comment: 'again' })).statusCode).toBe(400);
  expect(rows.updates).toHaveLength(0);
});

it('the case moved meanwhile: refused, nothing written', async () => {
  Case.update.mockResolvedValueOnce([0]);
  expect((await call({ id: 'c1', source: 'EMAIL', currentStatus: 'CLAIM_SUBMIT_FAILED' }, { action: 'prepare', comment: 'member fixed in IAS' })).statusCode).toBe(409);
  expect(rows.events).toHaveLength(0);
});

it("the upload's reason is its latest finished console-upload step (one rule for the button and the API)", () => {
  const steps = [
    { job: 'api-console-upload', status: 'DONE', output: { reasonCode: 'CONSOLE_UPLOAD_REFUSED' } },
    { job: 'api-console-upload', status: 'FAILED', output: null },
    { job: 'api-document-checking', status: 'DONE', output: {} },
  ];
  expect(consoleUploadReasonOf(steps)).toBe('CONSOLE_UPLOAD_REFUSED');
  expect(consoleUploadReasonOf([])).toBeNull();
});
