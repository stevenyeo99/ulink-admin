// member-verification/iasClient.js: the member info and member balance calls share one POST helper.
jest.mock('../config', () => ({ ias: { baseUrl: 'http://ias', getMemberInfoApi: '/api/get_member_info_by_policy', getMemberLimitBalanceApi: '/api/get_member_limit_balance', getMemberPolicyEventsApi: '/api/get_member_policy_events', timeoutMs: 1000 } }));
const config = require('../config');
const { getMemberInfo, getMemberLimitBalance, getMemberPolicyEvents } = require('../modules/member-verification/iasClient');

beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, payload: {} }) })); });

it('posts the balance request to its own path, and the member info request as before', async () => {
  await getMemberLimitBalance({ memberRefNo: 'M1', policyRefNo: 'P1', policyEffDate: '09012025' });
  await getMemberInfo({ memberNrc: 'N1', meplEffDate: '20260101' });
  expect(fetch.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
    ['http://ias/api/get_member_limit_balance', { memberRefNo: 'M1', policyRefNo: 'P1', policyEffDate: '09012025' }],
    ['http://ias/api/get_member_info_by_policy', { memberNrc: 'N1', meplEffDate: '20260101' }],
  ]);
});

it('throws on a non-2xx answer (the job retries next run), and without its configuration', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 502 });
  await expect(getMemberLimitBalance({})).rejects.toThrow('IAS member limit balance request failed with status 502');
  config.ias.getMemberLimitBalanceApi = undefined;
  await expect(getMemberLimitBalance({})).rejects.toThrow('GET_MEMBER_LIMIT_BALANCE_API must be configured');
});

it('posts the exclusion events request to its own path', async () => {
  await getMemberPolicyEvents({ policyNo: 'P1', memberNo: 'M1', policyEffDate: '2025-08-01' });
  expect(fetch.mock.calls[0][0]).toBe('http://ias/api/get_member_policy_events');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ policyNo: 'P1', memberNo: 'M1', policyEffDate: '2025-08-01' });
});
