// Cases list filters (group / module / search / sort) and the dashboard overview counts, built
// from the status catalog. Models are mocked: this checks the query each request builds.

jest.mock('../db/models', () => {
  return {
    Case: { findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })), findAll: jest.fn(), count: jest.fn() },
    ApiCaseStep: { findAll: jest.fn(async () => []) },
    CaseEvent: {}, CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {},
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

it('searches claim no., TPA case number, case id and claimant name, escaping LIKE wildcards', async () => {
  await call(listCases, { q: ' 50%_x ' });
  const or = lastQuery().where[Op.or];
  expect(or).toHaveLength(4);
  expect(or[0]).toEqual({ claimNo: { [Op.iLike]: '%50\\%\\_x%' } });
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
  Case.findAll.mockResolvedValue([
    { currentStatus: 'INCOMPLETE', count: '3' },
    { currentStatus: 'API_CLAIM_SUSPENDED', count: '2' },
    { currentStatus: 'CSR_SENT', count: '4' },
    { currentStatus: 'SOMETHING_NEW', count: '1' },
  ]);
  Case.count.mockResolvedValue(5);

  const { body } = await call(getOverview, {});

  expect(body).toMatchObject({ total: 10, newToday: 5 });
  expect(body.groups).toMatchObject({ waiting_customer: 5, done: 4, needs_review: 0 });
  expect(body).not.toHaveProperty('modules');
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
