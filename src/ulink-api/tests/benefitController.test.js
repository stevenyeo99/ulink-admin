// POST /api/cases/:id/benefit (SYSTEM_5 member balance phase C): at (API_)BENEFIT_REVIEW a person chooses the head of
// every voucher the AI was unsure of, from the member's own plan; the case goes back to the member check. Models mocked.
jest.mock('../db/models', () => ({
  sequelize: { transaction: jest.fn(async (fn) => fn('tx')) },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(), create: jest.fn() },
}));
jest.mock('../modules/case-claim/claim', () => ({ endClaim: jest.fn() }));

const { Case, CaseEvent, ApiCaseStep } = require('../db/models');
const { chooseBenefit } = require('../controllers/cases/benefitController');

const benefit = (type, head) => ({ benefit_type_code: type, benefit_type_desc: type, benefit_head_code: head, benefit_head_desc: head });
const iasMemberInfoResponse = { payload: {
  memberPlans: [{ plan: { PLAN_ID: '2311', REV_NO: '01' }, coverageLimits: [{ benefits: [benefit('IP', 'SUR'), benefit('OP', 'RX'), benefit('DT', null)] }] }],
} };
const extractedFields = { claim: { type_of_patient: 'Inpatient' }, invoices: { items: [{ subtotal: 30000, date: '2026-10-02', voucher_type: 'other' }, { subtotal: 5000, date: '2026-10-02', voucher_type: 'pharmacy' }] } };
const memberVerifyResult = { outcome: 'BENEFIT_REVIEW', balance: { unsure: [0], picks: [{ voucher: 0, benefitType: null, benefitHead: null, confidence: 0.3 }] } };
const emailCase = { id: 'c1', source: 'EMAIL', currentStatus: 'BENEFIT_REVIEW', toJSON: () => ({ id: 'c1', extractedFields, memberVerifyResult, iasMemberInfoResponse }) };

const send = async (body) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await chooseBenefit({ params: { id: 'c1' }, user: { username: 'ulink', name: 'Ulink' }, body: { comment: 'surgery bill', ...body } }, res);
  return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
};

beforeEach(() => {
  jest.clearAllMocks();
  Case.findByPk.mockResolvedValue({ ...emailCase });
});

it('refuses a head not on the plan, a missing head where the plan has heads, or an unsure voucher left out', async () => {
  expect((await send({ benefits: [{ voucher: 0, benefitType: 'IP', benefitHead: 'XX' }] })).body.error.message).toBe("Voucher 1: choose a benefit head of IP on the member's plan.");
  expect((await send({ benefits: [{ voucher: 0, benefitType: 'IP', benefitHead: null }] })).body.error.message).toBe("Voucher 1: choose a benefit head of IP on the member's plan.");
  expect((await send({ benefits: [{ voucher: 1, benefitType: 'OP', benefitHead: 'RX' }] })).body.error.message).toBe('Choose the benefit of voucher 1 — the AI was not sure of it.');
  expect((await send({ benefits: [{ voucher: 0, benefitType: 'IP', benefitHead: 'SUR' }], comment: '' })).status).toBe(400);
  expect(Case.update).not.toHaveBeenCalled();
});

it('email: saves the choice on the case as a chosen pick and sends the case back to the member check', async () => {
  const { body } = await send({ benefits: [{ voucher: 0, benefitType: 'IP', benefitHead: 'SUR' }] });
  expect(body).toEqual({ caseId: 'c1', currentStatus: 'RECOGNIZED' });
  const [update, where] = Case.update.mock.calls[0];
  expect(where.where).toEqual({ id: 'c1', currentStatus: 'BENEFIT_REVIEW' });
  expect(update.memberVerifyResult.balance.picks).toEqual([expect.objectContaining({
    voucher: 0, benefitType: 'IP', benefitHead: 'SUR', chosen: true, by: 'Ulink (ulink)', comment: 'surgery bill',
    key: { subtotal: 30000, date: '2026-10-02', voucherType: 'other' }, basis: { typeOfPatient: 'Inpatient', plan: { planId: '2311', revNo: '01' } },
  })]);
  expect(CaseEvent.create.mock.calls[0][0]).toMatchObject({ reasonCode: 'MANUAL_BENEFIT', newStatus: 'RECOGNIZED' });
});

it('API: a benefit-review step; recheck keeps the case where it is (the corrections move it)', async () => {
  Case.findByPk.mockResolvedValue({ id: 'c1', source: 'API', currentStatus: 'API_BENEFIT_REVIEW', toJSON: () => ({ id: 'c1' }) });
  ApiCaseStep.findAll.mockResolvedValue([
    { job: 'api-claim-recognition', status: 'DONE', output: { extractedFields } },
    { job: 'api-member-verification', status: 'DONE', output: { memberVerifyResult, iasMemberInfoResponse } },
  ]);
  const { body } = await send({ benefits: [{ voucher: 0, benefitType: 'IP', benefitHead: 'SUR' }], recheck: true });
  expect(body).toEqual({ caseId: 'c1', currentStatus: 'API_BENEFIT_REVIEW' });
  expect(ApiCaseStep.create.mock.calls[0][0]).toMatchObject({ job: 'benefit-review', status: 'DONE', output: { picks: [expect.objectContaining({ voucher: 0, chosen: true })] } });
});
