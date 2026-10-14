// SYSTEM_4 E4-04: api-console-watch — an API case waiting on documents moves on when the console has a submission the
// case doesn't have yet (uploaded from the case page or by anyone); our own upload that never appears is flagged.
// The console middleware is replaced here.

jest.mock('../db/models', () => ({ CaseDocument: { findAll: jest.fn() } }));
jest.mock('../modules/api-material-download/service', () => ({
  ...jest.requireActual('../modules/api-material-download/service'),
  listScanItems: jest.fn(),
}));

const config = require('../config');
const { CaseDocument } = require('../db/models');
const { listScanItems, job: downloadJob } = require('../modules/api-material-download/service');
const { job, WATCHED_STATUSES } = require('../modules/api-console-watch/service');
const { STEPS, API_STEPS } = require('../modules/pipeline/service');
const { CASE_STATUSES } = require('../modules/case-status/catalog');

const input = (extra = {}) => ({ 'api-claim-intake': { tpaCaseNumber: 'AYA-CL-26100012' }, ...extra });
const item = (scanId, barcodeId, pages = 2) => ({ scanId, barcodeId, materials: Array.from({ length: pages }, (_, i) => ({ id: i })) });
const run = (status, extra) => job.process({ caseRecord: { id: 'case-1', currentStatus: status }, input: input(extra) });

beforeEach(() => {
  jest.clearAllMocks();
  CaseDocument.findAll.mockResolvedValue([{ barcodeId: 'B1' }]);
});

it('watches the cases waiting on documents, runs before the download, which takes the new ones', () => {
  expect(WATCHED_STATUSES).toEqual(['API_NO_DOCUMENTS', 'API_CLAIM_SUSPENDED', 'API_DOCUMENTS_REVIEW', 'API_DOCUMENTS_UNSURE', 'API_DOCUMENTS_UPLOADED', 'API_UPLOAD_NOT_IN_CONSOLE']);
  const names = API_STEPS.map(([n]) => n);
  expect(names.indexOf('api-console-watch')).toBe(names.indexOf('api-material-download') - 1);
  expect(STEPS.map(([n]) => n)).not.toContain('api-console-watch');
  expect(downloadJob.inputStatus).toEqual(['API_RECEIVED', 'API_NEW_DOCUMENTS']);
  for (const s of ['API_DOCUMENTS_UPLOADED', 'API_NEW_DOCUMENTS', 'API_UPLOAD_NOT_IN_CONSOLE']) expect(CASE_STATUSES[s]).toBeDefined();
});

it('a new submission in the console (any uploader) → new documents, downloaded next', async () => {
  listScanItems.mockResolvedValue([item('API-AYA-CL-26100012', 'B1'), item('API-AYA-CL-26100012-01', 'B2')]);
  const result = await run('API_CLAIM_SUSPENDED');
  expect(result).toMatchObject({ nextStatus: 'API_NEW_DOCUMENTS', output: { scanId: 'API-AYA-CL-26100012', newBarcodes: ['B2'] } });
  expect(listScanItems).toHaveBeenCalledWith('API-AYA-CL-26100012');
});

it('nothing new, or a submission still without images → keeps waiting', async () => {
  listScanItems.mockResolvedValue([item('API-AYA-CL-26100012', 'B1'), item('API-AYA-CL-26100012-01', 'B2', 0)]);
  expect(await run('API_NO_DOCUMENTS')).toMatchObject({ wait: true });
});

it('our upload not in the console after the wait → a person checks; before that it waits', async () => {
  listScanItems.mockResolvedValue([item('API-AYA-CL-26100012', 'B1')]);
  const longAgo = new Date(Date.now() - (config.clUpload.barcodeWaitMinutes + 1) * 60000).toISOString();
  expect(await run('API_DOCUMENTS_UPLOADED', { 'case-upload': { uploadedAt: longAgo } })).toMatchObject({ nextStatus: 'API_UPLOAD_NOT_IN_CONSOLE' });
  expect(await run('API_DOCUMENTS_UPLOADED', { 'case-upload': { uploadedAt: new Date().toISOString() } })).toMatchObject({ wait: true });
  // Only our own upload is timed — a case simply waiting for the customer just waits.
  expect(await run('API_CLAIM_SUSPENDED', { 'case-upload': { uploadedAt: longAgo } })).toMatchObject({ wait: true });
});
