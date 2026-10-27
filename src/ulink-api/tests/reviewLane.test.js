// The API review lane (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md): a case a person decided is marked, only
// the review lane processes it, and the marker is cleared at its next stop, wait or end.
jest.mock('../db/models', () => ({
  sequelize: { transaction: jest.fn(async (fn) => fn('tx')), query: jest.fn() },
  Case: { findAll: jest.fn(async () => []), update: jest.fn(async () => [1]) },
  CaseEvent: { create: jest.fn(), bulkCreate: jest.fn() },
  PipelineRun: { findOne: jest.fn(), update: jest.fn() },
  ApiCaseStep: { findOne: jest.fn(async () => ({ output: {} })), create: jest.fn() },
  JobLock: { tableName: 'ulink_job_locks', update: jest.fn(), findByPk: jest.fn() },
  Setting: { findAll: jest.fn(async () => []) },
}));
jest.mock('../modules/llm-calls/log', () => ({ forCase: (id, job, fn) => fn() }));

const { Op } = require('sequelize');
const { Case, sequelize } = require('../db/models');
const { CASE_STATUSES } = require('../modules/case-status/catalog');
const { leavesLane, markFor } = require('../modules/review-lane/marker');
const { runApiJob } = require('../modules/api-pipeline/runApiJob');
const { REVIEW_JOBS } = require('../modules/review-lane/lane');
const jobLock = require('../jobs/jobLock');

beforeEach(() => jest.clearAllMocks());

it('every API status either leaves the lane or is read by a lane job, except the new-case statuses before the reading', () => {
  const inputs = new Set(REVIEW_JOBS.flatMap((name) => [].concat(require(`../modules/${name}/service`).job.inputStatus)));
  const stuck = Object.keys(CASE_STATUSES).filter((s) => s.startsWith('API_') && !leavesLane(s) && !inputs.has(s));
  // A decided case never goes back to intake or the console download (lane 1 work): those are new cases only.
  expect(stuck).toEqual(['API_RECEIVED', 'API_NEW_DOCUMENTS']);
  // Stops, waits for the customer or an outside system, and ends clear the marker.
  for (const s of ['API_MEMBER_REVIEW_REQUIRED', 'API_DOCUMENTS_REVIEW', 'API_CLAIM_SUSPENDED', 'API_CLAIM_REVISED', 'API_CLAIM_REVISION_FAILED', 'API_CONSOLE_BARCODE_PENDING', 'API_AWAITING_CSR']) {
    expect(leavesLane(s)).toBe(true);
  }
  expect(leavesLane('API_READY_FOR_DOCUMENT_CHECKING')).toBe(false);
});

it('only API cases are marked, with who decided', () => {
  expect(markFor({ source: 'API' }, 'Thin Zar (tz)')).toEqual({ reviewPendingAt: expect.any(Date), reviewPendingBy: 'Thin Zar (tz)' });
  expect(markFor({ source: 'EMAIL' }, 'Thin Zar (tz)')).toEqual({});
});

it('the existing pipeline takes unmarked cases; the review lane marked ones, the asked ones first', async () => {
  const job = { name: 'api-document-checking', inputStatus: 'API_READY_FOR_DOCUMENT_CHECKING', inputs: [], batchLimit: 5, process: jest.fn() };
  await runApiJob(job);
  expect(Case.findAll.mock.calls[0][0].where.reviewPendingAt).toBeNull();
  const id = '7a1c2b3d-0000-4000-8000-000000000001';
  await runApiJob(job, { lane: 'review', first: [id, "x'); drop table"] });
  const { where, order } = Case.findAll.mock.calls[1][0];
  expect(where.reviewPendingAt).toEqual({ [Op.ne]: null });
  // Only a real case id goes into the order (no SQL from the request).
  expect(order[0][0].val).toBe(`"Case"."id" IN ('${id}')`);
  expect(order[1]).toEqual(['reviewPendingAt', 'ASC']);
});

it('a case that reaches a stop is no longer marked; one still on its way keeps the marker', async () => {
  const caseRecord = { id: 'c1', currentStatus: 'API_READY_FOR_DOCUMENT_CHECKING' };
  Case.findAll.mockResolvedValue([caseRecord]);
  const job = (nextStatus) => ({ name: 'api-document-checking', inputStatus: caseRecord.currentStatus, inputs: [], batchLimit: 5, process: jest.fn(async () => ({ output: {}, nextStatus, message: 'x' })) });
  await runApiJob(job('API_DOCUMENTS_REVIEW'), { lane: 'review' });
  expect(Case.update.mock.calls[0][0]).toEqual({ currentStatus: 'API_DOCUMENTS_REVIEW', reviewPendingAt: null, reviewPendingBy: null });
  await runApiJob(job('API_DOCUMENTS_VERIFIED'), { lane: 'review' });
  expect(Case.update.mock.calls[1][0]).toEqual({ currentStatus: 'API_DOCUMENTS_VERIFIED' });
});

it('the lock: a stale lock can be taken over, and the run again flag is set and taken once', async () => {
  sequelize.query.mockResolvedValueOnce([[{ block_name: 'api-review-pipeline' }]]);
  expect(await jobLock.acquire('api-review-pipeline', { staleMs: 15 * 60 * 1000 })).toBe(true);
  expect(sequelize.query.mock.calls[0][0]).toMatch(/started_at < now\(\) - make_interval\(secs => :staleSecs\)/);
  expect(sequelize.query.mock.calls[0][1].replacements.staleSecs).toBe(900);
  sequelize.query.mockResolvedValueOnce([[]]);
  await jobLock.requestRerun('api-review-pipeline');
  sequelize.query.mockResolvedValueOnce([[{ block_name: 'api-review-pipeline' }]]).mockResolvedValueOnce([[]]);
  expect(await jobLock.takeRerun('api-review-pipeline')).toBe(true);
  expect(await jobLock.takeRerun('api-review-pipeline')).toBe(false);
});

describe('the Reviewed page (SYSTEM_5 review lane 4.6)', () => {
  const { runReviewed } = require('../controllers/cases/reviewedController');
  const send = async (body) => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await runReviewed({ user: { username: 'tz', name: 'Thin Zar' }, body }, res);
    return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0][0] };
  };

  it('refuses a run with no case, more than 20, or a case that is not being checked again', async () => {
    expect((await send({ caseIds: [] })).status).toBe(400);
    expect((await send({ caseIds: Array.from({ length: 21 }, (_, i) => `c${i}`) })).status).toBe(400);
    Case.findAll.mockResolvedValueOnce([{ id: 'c1', source: 'API', reviewPendingAt: null }]);
    const { status, body } = await send({ caseIds: ['c1'] });
    expect(status).toBe(400);
    expect(body.error.notMarked).toEqual(['c1']);
  });
});
