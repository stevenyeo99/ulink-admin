// Cases list filters (group / module / search / sort) and the dashboard overview counts, built
// from the status catalog. Models are mocked: this checks the query each request builds.

jest.mock('../db/models', () => {
  return {
    Setting: { findAll: jest.fn(async () => []) },
    CaseClaim: { findByPk: jest.fn(async () => null), findAll: jest.fn(async () => []), destroy: jest.fn() },
    Case: { findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })), findAll: jest.fn(), count: jest.fn() },
    ApiCaseStep: { findAll: jest.fn(async () => []) },
    CaseEvent: {}, CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {},
    sequelize: { escape: (v) => `'${v.replace(/'/g, "''")}'` },
  };
});

const { Op } = require('sequelize');
const { Case } = require('../db/models');
const { listCases, getOverview, getApprovals } = require('../controllers/cases/casesController');

const call = async (handler, query) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await handler({ query }, res);
  return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
};
const lastQuery = () => Case.findAndCountAll.mock.calls.at(-1)[0];

beforeEach(() => jest.clearAllMocks());

it('turns group and module into the status codes they share', async () => {
  await call(listCases, { group: 'needs_review', module: 'member' });
  expect(lastQuery().where.currentStatus.sort()).toEqual(['API_MEMBER_REVIEW_REQUIRED', 'MEMBER_REVIEW_REQUIRED']);
});

it('searches claim no., TPA case number, case id, claimant name and NRC, escaping LIKE wildcards', async () => {
  await call(listCases, { q: ' 50%_x ' });
  const or = lastQuery().where[Op.or];
  expect(or).toHaveLength(6);
  expect(or[0]).toEqual({ claimNo: { [Op.iLike]: '%50\\%\\_x%' } });
  expect(or[4].attribute.val).toContain('claimant_nrc_passport');
});

it('finds API cases by the claimant name and NRC in their recognition step, quoting the text', async () => {
  await call(listCases, { q: "O'Neil" });
  const exists = lastQuery().where[Op.or][5].val;
  expect(exists).toContain("s.job = 'api-claim-recognition'");
  expect(exists).toContain("s.output->'extractedFields'->'claimant'->>'claimant_nrc_passport' ILIKE '%O''Neil%'");
});

it('sorts by an allowed column only, newest first by default', async () => {
  await call(listCases, { sort: 'claimNo', dir: 'asc' });
  expect(lastQuery().order[0]).toEqual(['claimNo', 'ASC']);
  await call(listCases, { sort: 'password', dir: 'sideways' });
  expect(lastQuery().order[0]).toEqual(['updatedAt', 'DESC']);
});

it('rejects an unknown group or module', async () => {
  expect((await call(listCases, { group: 'x' })).status).toBe(400);
  expect((await call(listCases, { module: 'x' })).status).toBe(400);
});

it('counts cases per group, and new today', async () => {
  Case.findAll.mockResolvedValueOnce([
    { currentStatus: 'INCOMPLETE', count: '3' },
    { currentStatus: 'API_CLAIM_SUSPENDED', count: '2' },
    { currentStatus: 'CSR_SENT', count: '4' },
    { currentStatus: 'SOMETHING_NEW', count: '1' },
  ]);
  Case.count.mockResolvedValue(5);
  Case.findAll.mockResolvedValueOnce([]);

  const { body } = await call(getOverview, {});

  expect(body).toMatchObject({ total: 10, newToday: 5 });
  expect(body.groups).toMatchObject({ waiting_customer: 5, done: 4, needs_review: 0 });
  expect(body).not.toHaveProperty('modules');
});

it('counts the last 14 days of claims by outcome, per Myanmar day', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon' }).format(new Date());
  const at = `${today}T09:00:00+06:30`;
  Case.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([
    { createdAt: at, currentStatus: 'CSR_SENT', isStp: true },
    { createdAt: at, currentStatus: 'CLAIM_CREATED', isStp: true },
    { createdAt: at, currentStatus: 'CLAIM_CREATED', isStp: false },
    { createdAt: at, currentStatus: 'API_CLAIM_REVISED', isStp: null },
    { createdAt: at, currentStatus: 'API_CLAIM_SUSPENDED', isStp: null },
    { createdAt: at, currentStatus: 'API_DOCUMENTS_REVIEW', isStp: null },
  ]);
  Case.count.mockResolvedValue(6);

  const { body } = await call(getOverview, { source: 'API' });

  expect(body.days).toHaveLength(14);
  expect(body.days.at(-1)).toEqual({ day: today, stp: 2, approval: 2, incomplete: 1, processing: 1 });
  expect(body.days[0]).toMatchObject({ stp: 0, approval: 0, incomplete: 0, processing: 0 });
  expect(Case.findAll.mock.calls[1][0].where.source).toBe('API');
});

it('lists non-STP claims waiting for JD3, with the review points JD3 should look at', async () => {
  Case.findAll.mockResolvedValue([
    {
      id: 'c1', source: 'EMAIL', currentStatus: 'CLAIM_CREATED', claimNo: '26', isStp: false,
      claimPrepMeta: { diagnosis: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0 } },
    },
  ]);

  const { body } = await call(getApprovals, {});

  const { where } = Case.findAll.mock.calls.at(-1)[0];
  expect(where[Op.or]).toEqual([
    { currentStatus: 'CLAIM_CREATED', isStp: { [Op.not]: true } },
    { currentStatus: 'API_CLAIM_REVISED' },
  ]);
  expect(body.total).toBe(1);
  expect(body.items[0]).toMatchObject({ id: 'c1', claimNo: '26' });
  expect(body.items[0].reviewPoints).toEqual(["Diagnosis code: Check the AI's result against the documents."]);
});
