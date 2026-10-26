// SYSTEM_5 member balance phase D: a case waiting at API_BALANCE_REVIEW is asked again each run (balance only, no AI);
// once no shortage is left uncovered it goes back to claim preparation by itself.
jest.mock('../modules/ias-claim-preparation/service', () => ({ checkCase: jest.fn() }));
jest.mock('../modules/member-verification/memberBalance', () => ({ heldBalanceEnough: jest.fn() }));
jest.mock('../db/models', () => ({ ...jest.requireActual('../db/models'), Case: { update: jest.fn(async () => [1]) } }));

const { checkCase } = require('../modules/ias-claim-preparation/service');
const { heldBalanceEnough } = require('../modules/member-verification/memberBalance');
const { Case } = require('../db/models');
const { job } = require('../modules/api-claim-preparation/service');

const held = { claimPrepMeta: { lines: [{ pick: { benefitType: 'IP', benefitHead: 'SUR' } }] } };
const input = {
  'api-claim-recognition': { extractedFields: { invoices: { items: [{ subtotal: 1 }] } } },
  'api-member-verification': { iasMemberInfoResponse: { success: true }, memberVerifyResult: {} },
  'api-claim-preparation': held,
};
const caseRecord = { id: 'c1', currentStatus: 'API_BALANCE_REVIEW' };

beforeEach(() => jest.clearAllMocks());

it('still short: waits at the back of the queue, with claim preparation\'s heads and no preparation run', async () => {
  heldBalanceEnough.mockResolvedValue(false);
  expect(await job.process({ caseRecord, input })).toEqual({ wait: true, output: held });
  expect(heldBalanceEnough.mock.calls[0][3]).toBe(held.claimPrepMeta);
  expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'API_BALANCE_REVIEW' }, { where: { id: 'c1', currentStatus: 'API_BALANCE_REVIEW' } });
  expect(checkCase).not.toHaveBeenCalled();
});

it('enough again: back to claim preparation', async () => {
  heldBalanceEnough.mockResolvedValue(true);
  expect(await job.process({ caseRecord, input })).toMatchObject({ nextStatus: 'API_READY_FOR_CLAIM_PREPARATION' });
});


