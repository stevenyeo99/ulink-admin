// POST /api/cases/:id/preparation (owner, 2026-10-20): at API_PREPARATION_REVIEW a person decides what the AI wasn't sure
// of — every flagged voucher, a benefit type + head on the member's own plan, the diagnosis when it was unsure. All or
// nothing. Models are mocked.
jest.mock('../db/models', () => ({
  sequelize: { transaction: jest.fn(async (fn) => fn('tx')) },
  Case: { findByPk: jest.fn(), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(), create: jest.fn() },
}));
jest.mock('../modules/icd10/lookup', () => ({
  findCandidates: jest.fn(),
  findByCode: jest.fn(async (code) => (code === 'K05.1' ? { diagOid: '104612', diagCode: 'K05.1', diagDesc: 'Chronic gingivitis' } : null)),
}));
jest.mock('../modules/case-claim/claim', () => ({ endClaim: jest.fn() }));

const { Case, CaseEvent, ApiCaseStep } = require('../db/models');
const { choosePreparation } = require('../controllers/cases/preparationController');

const benefit = (type, head) => ({ benefit_type_code: type, benefit_type_desc: type, benefit_head_code: head, benefit_head_desc: head });
const steps = (review) => [
  { job: 'api-claim-recognition', status: 'DONE', output: { extractedFields: { invoices: { items: [
    { subtotal: 30000, date: '2026-10-02', voucher_type: 'consultation' }, { subtotal: 50000, date: '2026-10-02', voucher_type: 'pharmacy' },
  ] } } } },
  { job: 'api-member-verification', status: 'DONE', output: { iasMemberInfoResponse: { payload: { memberPlans: [{ coverageLimits: [{ benefits: [benefit('DT', 'SCP'), benefit('OP', 'RX')] }] }] } } } },
  { job: 'api-claim-preparation', status: 'DONE', output: { claimPrepMeta: {
    diagnosis: { text: 'Diagnosis/illness: Toothache', pick: { diagCode: 'R69' }, defaulted: true, confidence: 0.4 },
    lines: [{ pick: { benefitType: 'DT', benefitHead: null }, confidence: 0.9 }, { pick: { benefitType: 'OP', benefitHead: 'RX' }, confidence: 0.9 }],
    review,
  } } },
];
const send = async (body) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await choosePreparation({ params: { id: 'c1' }, user: { username: 'ulink', name: 'Ulink' }, body: { comment: 'per the plan', ...body } }, res);
  return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
};

beforeEach(() => {
  jest.clearAllMocks();
  Case.findByPk.mockResolvedValue({ id: 'c1', source: 'API', currentStatus: 'API_PREPARATION_REVIEW' });
});

it('refuses a pair not on the plan, a flagged voucher left out, or an unsure diagnosis left out — nothing saved', async () => {
  ApiCaseStep.findAll.mockResolvedValue(steps({ diagnosis: false, vouchers: [0] }));
  expect((await send({ benefits: [{ voucher: 0, benefitType: 'DT', benefitHead: 'RX' }] })).body.error.message).toMatch(/not on the member's plan/);
  expect((await send({ benefits: [{ voucher: 1, benefitType: 'OP', benefitHead: 'RX' }] })).body.error.message).toMatch(/voucher 1/);

  ApiCaseStep.findAll.mockResolvedValue(steps({ diagnosis: true, vouchers: [] }));
  expect((await send({})).body.error.message).toMatch(/^Diagnosis/);
  expect((await send({ diagCode: 'ZZZ' })).body.error.message).toMatch(/^Diagnosis/);
  expect(Case.update).not.toHaveBeenCalled();
  expect(ApiCaseStep.create).not.toHaveBeenCalled();
});

it('saves the choices with the AI picks beside them and sends the case back to claim preparation once', async () => {
  ApiCaseStep.findAll.mockResolvedValue(steps({ diagnosis: true, vouchers: [0] }));
  const { status } = await send({ diagCode: 'K05.1', benefits: [{ voucher: 0, benefitType: 'DT', benefitHead: 'SCP' }] });

  expect(status).toBe(200);
  expect(Case.update).toHaveBeenCalledWith({ currentStatus: 'API_READY_FOR_CLAIM_PREPARATION' }, expect.objectContaining({ where: { id: 'c1', currentStatus: 'API_PREPARATION_REVIEW' } }));
  const { output } = ApiCaseStep.create.mock.calls[0][0];
  expect(output.diagnosis).toMatchObject({ diagCode: 'K05.1', text: 'Diagnosis/illness: Toothache', aiPick: { pick: { diagCode: 'R69' } } });
  expect(output.benefits).toEqual([expect.objectContaining({
    voucher: 0, benefitType: 'DT', benefitHead: 'SCP', key: { subtotal: 30000, date: '2026-10-02', voucherType: 'consultation' }, aiPick: expect.objectContaining({ pick: { benefitType: 'DT', benefitHead: null } }),
  })]);
  expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'MANUAL_PREPARATION', message: expect.stringContaining('voucher 1 DT/SCP (AI: DT/-)') }), expect.anything());
});

it('manual rejections (vitamins / supplements): on any voucher, flagged ones decided, amount within the voucher, a remark', async () => {
  ApiCaseStep.findAll.mockResolvedValue(steps({ diagnosis: false, vouchers: [], rejections: [1] }));
  expect((await send({ rejections: [{ voucher: 0, amount: 1000, remark: 'Zinc' }] })).body.error.message).toMatch(/voucher 2/);
  expect((await send({ rejections: [{ voucher: 1, amount: 60000, remark: 'Zinc' }] })).body.error.message).toMatch(/more than the voucher/);
  expect((await send({ rejections: [{ voucher: 1, amount: 0, remark: 'Zinc' }] })).body.error.message).toMatch(/more than 0/);
  expect((await send({ rejections: [{ voucher: 1, amount: 6000, remark: ' ' }] })).body.error.message).toMatch(/remark/);
  expect(ApiCaseStep.create).not.toHaveBeenCalled();

  const { status } = await send({ rejections: [{ voucher: 1, amount: 6000, remark: 'Superkids Z - 6,000 MMK is not covered due to supplement.' }, { voucher: 0, amount: null }] });
  expect(status).toBe(200);
  expect(ApiCaseStep.create.mock.calls[0][0].output.rejections).toEqual([
    { voucher: 1, key: { subtotal: 50000, date: '2026-10-02', voucherType: 'pharmacy' }, amount: 6000, remark: 'Superkids Z - 6,000 MMK is not covered due to supplement.' },
    { voucher: 0, key: { subtotal: 30000, date: '2026-10-02', voucherType: 'consultation' }, amount: null, remark: null },
  ]);
});
