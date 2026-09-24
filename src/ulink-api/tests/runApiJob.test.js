// The shared API job runner: a job receives exactly the outputs of the jobs it names, and each
// outcome (DONE / WAITING / FAILED) is recorded as a step row. Models are in-memory.

jest.mock('../db/models', () => {
  const steps = [];
  const events = [];
  const cases = [];
  const byNewest = (rows) => [...rows].sort((a, b) => b.seq - a.seq);
  let seq = 0;
  const makeStep = (row) => ({ ...row, seq: (seq += 1), update: jest.fn(async function update(fields) { Object.assign(this, fields); return this; }) });
  return {
    steps,
    events,
    cases,
    sequelize: { transaction: (fn) => fn({}) },
    Case: {
      // Copies, like real Sequelize instances: a later change to the row doesn't change them.
      findAll: jest.fn(async ({ where }) => cases.filter((c) => c.source === where.source && [].concat(where.currentStatus).includes(c.currentStatus)).map((c) => ({ ...c }))),
      update: jest.fn(async (fields, { where }) => {
        const c = cases.find((x) => x.id === where.id && x.source === where.source && x.currentStatus === where.currentStatus);
        if (!c) return [0];
        Object.assign(c, fields);
        return [1];
      }),
    },
    CaseEvent: { create: jest.fn(async (row) => events.push(row)) },
    ApiCaseStep: {
      findOne: jest.fn(async ({ where }) =>
        byNewest(steps).find((s) => s.caseId === where.caseId && s.job === where.job && (!where.status || s.status === where.status)) ?? null),
      create: jest.fn(async (row) => { const step = makeStep(row); steps.push(step); return step; }),
    },
  };
});

const models = require('../db/models');
const { runApiJob } = require('../modules/api-pipeline/runApiJob');

const job = (process) => ({ name: 'job-b', inputStatus: 'API_A_DONE', inputs: ['job-a'], batchLimit: 10, process });

beforeEach(() => {
  jest.clearAllMocks();
  models.steps.length = 0;
  models.events.length = 0;
  models.cases.length = 0;
  models.cases.push({ id: 'case-1', source: 'API', currentStatus: 'API_A_DONE' });
  // job-a ran twice; only its latest DONE output counts.
  models.ApiCaseStep.create({ caseId: 'case-1', job: 'job-a', status: 'DONE', output: { v: 1 } });
  models.ApiCaseStep.create({ caseId: 'case-1', job: 'job-a', status: 'DONE', output: { v: 2 } });
  models.ApiCaseStep.create.mockClear();
});

it("passes the named jobs' latest output as input, and records DONE with the status move and event", async () => {
  const process = jest.fn(async ({ input }) => ({ output: { got: input }, nextStatus: 'API_B_DONE', message: 'ok' }));

  expect(await runApiJob(job(process))).toEqual({ processed: 1, waiting: 0, errors: [] });

  expect(process.mock.calls[0][0].input).toEqual({ 'job-a': { v: 2 } });
  expect(models.cases[0].currentStatus).toBe('API_B_DONE');
  const done = models.steps.find((s) => s.job === 'job-b');
  expect(done).toMatchObject({ status: 'DONE', input: { 'job-a': { v: 2 } }, output: { got: { 'job-a': { v: 2 } } } });
  expect(models.events[0]).toMatchObject({ blockName: 'job-b', prevStatus: 'API_A_DONE', newStatus: 'API_B_DONE' });
});

it('only selects API cases at the input status', async () => {
  await runApiJob(job(jest.fn()));
  expect(models.Case.findAll.mock.calls[0][0].where).toEqual({ source: 'API', currentStatus: 'API_A_DONE' });
});

it('records WAITING without moving the case, and updates that row on the next wait', async () => {
  const process = jest.fn(async () => ({ wait: true, output: { reason: 'not yet' } }));

  expect(await runApiJob(job(process))).toEqual({ processed: 0, waiting: 1, errors: [] });
  await runApiJob(job(process));

  const waits = models.steps.filter((s) => s.job === 'job-b');
  expect(waits).toHaveLength(1);
  expect(waits[0]).toMatchObject({ status: 'WAITING', output: { reason: 'not yet' } });
  expect(models.cases[0].currentStatus).toBe('API_A_DONE');
});

it('records FAILED with the error and leaves the case for the next run', async () => {
  const summary = await runApiJob(job(async () => { throw new Error('middleware down'); }));

  expect(summary.errors).toEqual([{ caseId: 'case-1', error: 'middleware down' }]);
  expect(models.steps.find((s) => s.job === 'job-b')).toMatchObject({ status: 'FAILED', error: 'middleware down' });
  expect(models.cases[0].currentStatus).toBe('API_A_DONE');
});

it('fails when the earlier job has no output for the case', async () => {
  models.steps.length = 0;
  const process = jest.fn();
  const summary = await runApiJob(job(process));
  expect(process).not.toHaveBeenCalled();
  expect(summary.errors[0].error).toMatch(/No output from job-a/);
});

it('does not move a case that left the input status meanwhile', async () => {
  const summary = await runApiJob(job(async () => {
    models.cases[0].currentStatus = 'API_ELSEWHERE'; // changed by someone else while running
    return { output: {}, nextStatus: 'API_B_DONE', message: 'ok' };
  }));
  expect(summary.errors[0].error).toMatch(/left API_A_DONE/);
  expect(models.cases[0].currentStatus).toBe('API_ELSEWHERE');
});

it('accepts several input statuses and records the status the case was actually at', async () => {
  models.cases[0].currentStatus = 'API_RETRY';
  const multi = { ...job(async () => ({ output: {}, nextStatus: 'API_B_DONE', message: 'ok' })), inputStatus: ['API_A_DONE', 'API_RETRY'] };

  expect(await runApiJob(multi)).toEqual({ processed: 1, waiting: 0, errors: [] });
  expect(models.events[0]).toMatchObject({ prevStatus: 'API_RETRY', newStatus: 'API_B_DONE' });
});
