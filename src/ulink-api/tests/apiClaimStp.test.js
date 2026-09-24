const fs = require('fs');
const os = require('os');
const path = require('path');

// api-claim-stp: the email flow's ias-claim-stp pieces (checkClaimStatus, downloadFile,
// csrDestination) reused for API cases. IAS is mocked; the CSR is written to a temp folder.

jest.mock('../config', () => {
  const nodeFs = jest.requireActual('fs');
  const nodeOs = jest.requireActual('os');
  const nodePath = jest.requireActual('path');
  return { csrUpload: { root: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'api-csr-test-')), batchLimit: 20 } };
});
jest.mock('../modules/ias-claim-stp/service', () => ({
  checkClaimStatus: jest.fn(),
  csrDestination: jest.requireActual('../modules/ias-claim-stp/service').csrDestination,
}));
jest.mock('../modules/ias-claim-stp/iasClaimStatusClient', () => ({ downloadFile: jest.fn() }));

const config = require('../config');
const { checkClaimStatus } = require('../modules/ias-claim-stp/service');
const { downloadFile } = require('../modules/ias-claim-stp/iasClaimStatusClient');
const { job } = require('../modules/api-claim-stp/service');

const caseRecord = { id: 'case-1', currentStatus: 'API_AWAITING_CSR' };
const input = { 'api-claim-intake': { clNo: '2604050015', tpaCaseNumber: 'T' } };

beforeEach(() => jest.clearAllMocks());
afterAll(() => fs.rmSync(config.csrUpload.root, { recursive: true, force: true }));

it('runs on STP claims waiting for the settlement report', () => {
  expect(job).toMatchObject({ inputStatus: 'API_AWAITING_CSR', inputs: ['api-claim-intake'] });
});

it('waits while IAS has no settlement report yet', async () => {
  checkClaimStatus.mockResolvedValue({ caseId: 'case-1', ready: false });
  expect(await job.process({ caseRecord, input })).toMatchObject({ wait: true });
  expect(checkClaimStatus).toHaveBeenCalledWith({ id: 'case-1', claimNo: '2604050015' });
  expect(downloadFile).not.toHaveBeenCalled();
});

it('downloads the report into the CSR folder and asks for the CSR_REPORT customer email', async () => {
  checkClaimStatus.mockResolvedValue({ ready: true, filename: 'CSR_1.pdf', filepath: '/AYAS/Claims/x/' });
  downloadFile.mockResolvedValue(Buffer.from('%PDF'));

  const result = await job.process({ caseRecord, input });

  expect(downloadFile).toHaveBeenCalledWith({ filepath: '/AYAS/Claims/x/', filename: 'CSR_1.pdf' });
  const { csrFilePath } = result.output;
  expect(csrFilePath.startsWith(path.resolve(config.csrUpload.root))).toBe(true);
  expect(csrFilePath.endsWith(path.join('2604050015', 'CSR', 'CSR_1.pdf'))).toBe(true);
  expect(fs.readFileSync(csrFilePath, 'utf8')).toBe('%PDF');
  expect(result).toMatchObject({
    nextStatus: 'API_CSR_SENT',
    output: { email: { taskType: 'CSR_REPORT', audience: 'customer', payload: { csrFilePath, claimNo: '2604050015' }, dedupeKey: 'CSR_1.pdf' } },
  });
});

it('lets an IAS failure throw, so the runner retries next run', async () => {
  checkClaimStatus.mockRejectedValue(new Error('IAS request timed out'));
  await expect(job.process({ caseRecord, input })).rejects.toThrow(/timed out/);
});
