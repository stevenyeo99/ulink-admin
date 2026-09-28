// STP eligibility: the yes/no is unchanged (total ≤ the route+currency limit, no limit → not STP);
// the total, limit and currency now come back with it so the decision can be explained.

jest.mock('../db/models', () => ({ StpLimit: { findOne: jest.fn() } }));

const { StpLimit } = require('../db/models');
const { stpDecision } = require('../modules/ias-claim-preparation/stpEligibility');

beforeEach(() => jest.clearAllMocks());

it('is STP at or under the limit, and returns the numbers compared', async () => {
  StpLimit.findOne.mockResolvedValue({ amountLimit: '300000' });
  expect(await stpDecision({ routeKey: 'ayas_member_claim', currency: 'MMK', presentedAmt: 300000 }))
    .toEqual({ isStp: true, total: 300000, limit: 300000, currency: 'MMK' });
  expect((await stpDecision({ routeKey: 'ayas_member_claim', currency: 'MMK', presentedAmt: 300001 })).isStp).toBe(false);
});

it('is not STP when no limit is configured or the amount is unknown', async () => {
  StpLimit.findOne.mockResolvedValue(null);
  expect(await stpDecision({ routeKey: 'ayas_member_claim', currency: 'MMK', presentedAmt: 1 }))
    .toEqual({ isStp: false, total: 1, limit: null, currency: 'MMK' });
  expect((await stpDecision({ routeKey: 'ayas_member_claim', currency: 'MMK', presentedAmt: null })).isStp).toBe(false);
  expect(StpLimit.findOne).toHaveBeenCalledTimes(1);
});
