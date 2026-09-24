// api-claim-revision: sends the prepared body to IAS and maps the answer like the email flow's
// claim creation. The IAS client is mocked; no real IAS write.

jest.mock('../modules/api-claim-revision/iasClient', () => ({ reviseClaim: jest.fn() }));

const { reviseClaim } = require('../modules/api-claim-revision/iasClient');
const { job } = require('../modules/api-claim-revision/service');

const caseRecord = { id: 'case-1', currentStatus: 'API_CLAIM_PAYLOAD_PREPARED' };
const inputWith = ({ isSuspense, isStp }) => ({
  'api-claim-preparation': { payload: { claimNo: '2604050015', isSuspense, Items: [] }, documentsComplete: isSuspense === 'N', isStp },
});

beforeEach(() => jest.clearAllMocks());

it('receives the prepared payload and runs on API_CLAIM_PAYLOAD_PREPARED', () => {
  expect(job).toMatchObject({ inputStatus: 'API_CLAIM_PAYLOAD_PREPARED', inputs: ['api-claim-preparation'] });
});

it('sends the prepared body as-is and marks a complete claim revised, handing non-STP to JD2', async () => {
  reviseClaim.mockResolvedValue({ success: true, payload: { claimNo: '2604050015' } });
  const input = inputWith({ isSuspense: 'N', isStp: false });

  const result = await job.process({ caseRecord, input });

  expect(reviseClaim).toHaveBeenCalledWith(input['api-claim-preparation'].payload);
  expect(result).toMatchObject({
    nextStatus: 'API_CLAIM_REVISED',
    output: { isSuspense: 'N', email: { taskType: 'CLAIM_APPROVAL_REVIEW', audience: 'internal', payload: { caseId: 'case-1', claimNo: '2604050015' } } },
  });
});

it('sends an STP claim on to the settlement report (no approval email)', async () => {
  reviseClaim.mockResolvedValue({ success: true });
  const result = await job.process({ caseRecord, input: inputWith({ isSuspense: 'N', isStp: true }) });
  expect(result).toMatchObject({ nextStatus: 'API_AWAITING_CSR', output: { email: null } });
});

it('marks a revision with missing documents suspended (waits for the customer)', async () => {
  reviseClaim.mockResolvedValue({ success: true });
  const result = await job.process({ caseRecord, input: inputWith({ isSuspense: 'Y', isStp: false }) });
  expect(result).toMatchObject({ nextStatus: 'API_CLAIM_SUSPENDED', output: { isSuspense: 'Y', email: null } });
});

it("treats IAS's success:false as a rejection: not retried, internal email", async () => {
  reviseClaim.mockResolvedValue({ success: false, error: 'Claim not found' });
  const result = await job.process({ caseRecord, input: inputWith({ isSuspense: 'N', isStp: false }) });
  expect(result).toMatchObject({
    nextStatus: 'API_CLAIM_REVISION_FAILED',
    output: { email: { taskType: 'CLAIM_SUBMIT_ISSUE', audience: 'internal', payload: { caseId: 'case-1', errorMessage: 'Claim not found' } } },
  });
});

it('lets a technical failure throw, so the runner retries it next run', async () => {
  reviseClaim.mockRejectedValue(new Error('IAS claim revision request timed out after 30000ms'));
  await expect(job.process({ caseRecord, input: inputWith({ isSuspense: 'N', isStp: false }) })).rejects.toThrow(/timed out/);
});
