// Audit snapshot of the AI assessment when a claim is created: STP claims keep it on the
// CLAIM_CREATED event (rawRef); non-STP claims keep it in the JD2 email task instead.

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  Case: { update: jest.fn() },
  CaseEvent: { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../modules/shared/emailTaskQueue', () => ({ queueDedupedTask: jest.fn() }));

const { CaseEvent } = require('../db/models');
const { queueDedupedTask } = require('../modules/shared/emailTaskQueue');
const { persistOutcome } = require('../modules/ias-claim-creation/service');

const caseRecord = (isStp) => ({
  id: 'case-1',
  currentStatus: 'CLAIM_PAYLOAD_PREPARED',
  isStp,
  claimPrepMeta: { stp: { source: 'EMAIL', currency: 'MMK', benefits: [{ benefitType: 'OP', total: 1000, allowed: true, limit: 50000 }], reasons: [] } },
});
const createdEvent = () => CaseEvent.create.mock.calls.find(([e]) => e.newStatus === 'CLAIM_CREATED')[0];

beforeEach(() => jest.clearAllMocks());

it('keeps the assessment on the event for an STP claim, with no JD2 email', async () => {
  await persistOutcome(caseRecord(true), { response: { success: true, payload: { claimNo: 'CL-1' } } });
  expect(createdEvent().rawRef).toContain('STP: Yes');
  expect(queueDedupedTask).not.toHaveBeenCalled();
});

it('leaves the event empty for a non-STP claim (the JD2 email carries it)', async () => {
  await persistOutcome(caseRecord(false), { response: { success: true, payload: { claimNo: 'CL-1' } } });
  expect(createdEvent().rawRef).toBeNull();
  expect(queueDedupedTask).toHaveBeenCalledWith('tx', expect.objectContaining({ taskType: 'CLAIM_APPROVAL_REVIEW' }));
});
