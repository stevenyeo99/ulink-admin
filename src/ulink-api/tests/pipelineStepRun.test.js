// "Run this step" from the console: a pipeline run can be limited to chosen steps. Without a step
// list every step runs, exactly as before. Models and locks are mocked; every step's service is
// replaced by a stub so no real job runs.

jest.mock('../db/models', () => {
  const makeRow = (row) => ({ ...row, update: jest.fn(async function update(f) { Object.assign(this, f); return this; }) });
  return {
    PipelineRun: { create: jest.fn(async (row) => makeRow({ id: 'run-1', ...row })) },
    PipelineRunStep: { create: jest.fn(async (row) => makeRow(row)), count: jest.fn(async () => 0) },
  };
});
jest.mock('../jobs/jobLock', () => ({ acquire: jest.fn(async () => true), release: jest.fn(async () => {}), isRunning: jest.fn() }));

const jobLock = require('../jobs/jobLock');
const pipelineService = require('../modules/pipeline/service');
const { STEPS, API_STEPS, PIPELINES, stepNames } = pipelineService;
const pipelineController = require('../controllers/job/pipelineController');

const ran = [];
beforeAll(() => {
  for (const [name, service] of [...STEPS, ...API_STEPS]) service.run = jest.fn(async () => { ran.push(name); return {}; });
});
beforeEach(() => { ran.length = 0; jest.clearAllMocks(); });

const runOf = (pipeline) => ({ id: 'run-1', pipeline, update: jest.fn() });

it('runs every step when no step list is given (unchanged behaviour)', async () => {
  await pipelineService.executeSteps(runOf('EMAIL'));
  expect(ran).toEqual(stepNames('EMAIL'));
});

it('runs only the chosen steps, in pipeline order', async () => {
  await pipelineService.executeSteps(runOf('EMAIL'), ['document-checking', 'claim-recognition']);
  expect(ran).toEqual(['claim-recognition', 'document-checking']);

  ran.length = 0;
  await pipelineService.executeSteps(runOf('API'), ['api-claim-recognition']);
  expect(ran).toEqual(['api-claim-recognition']);
});

it('lists each pipeline its own step names', () => {
  expect(stepNames('EMAIL')).toEqual(PIPELINES.EMAIL.map(([n]) => n));
  expect(stepNames('API')).toContain('api-email-sender');
  expect(stepNames('EMAIL')).not.toContain('api-email-sender');
});

describe('POST .../run with steps', () => {
  const call = async (controller, body) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
    await controller.runPipeline({ body }, res);
    return res;
  };

  it("rejects a step that isn't in that pipeline, before taking the lock", async () => {
    for (const steps of [['api-claim-recognition'], [], 'claim-recognition', [42]]) {
      const res = await call(pipelineController, { steps }); // the email pipeline
      expect(res.statusCode).toBe(400);
    }
    expect(jobLock.acquire).not.toHaveBeenCalled();
  });

  it('starts a run limited to the chosen step', async () => {
    const res = await call(pipelineController.apiPipeline, { steps: ['api-claim-stp'] });
    expect(res.body).toMatchObject({ block: 'api-pipeline', started: true, steps: ['api-claim-stp'] });
    await new Promise((resolve) => setImmediate(resolve)); // the run itself continues in the background
  });

  it('runs the whole pipeline when there is no body, as before', async () => {
    const res = await call(pipelineController, undefined);
    expect(res.body).toEqual({ block: 'pipeline', started: true, runId: 'run-1' });
  });
});
