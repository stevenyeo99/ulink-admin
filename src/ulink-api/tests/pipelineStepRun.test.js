// "Run this step" from the console: a pipeline run can be limited to chosen steps. Without a step
// list every step runs, exactly as before. Models and locks are mocked; every step's service is
// replaced by a stub so no real job runs.

jest.mock('../db/models', () => {
  const makeRow = (row) => ({ ...row, update: jest.fn(async function update(f) { Object.assign(this, f); return this; }) });
  return {
    PipelineRun: { create: jest.fn(async (row) => makeRow({ id: 'run-1', ...row })) },
    PipelineRunStep: { create: jest.fn(async (row) => makeRow(row)), count: jest.fn(async () => 0) },
    Setting: { findAll: jest.fn(async () => []) }, // the settings' defaults: both sources on
  };
});
jest.mock('../jobs/jobLock', () => ({ acquire: jest.fn(async () => true), release: jest.fn(async () => {}), isRunning: jest.fn() }));

const jobLock = require('../jobs/jobLock');
const pipelineService = require('../modules/pipeline/service');
const { STEPS, API_STEPS, PIPELINES, stepNames } = pipelineService;
const pipelineController = require('../controllers/job/pipelineController');

const ran = [];
beforeAll(() => {
  for (const [name, service] of [...STEPS, ...API_STEPS]) {
    service.run = jest.fn(async () => { ran.push(name); return {}; });
    // Every step counts as set up here (the real check reads this machine's .env); the inbox test overrides it.
    if (service.notConfiguredReason) service.notConfiguredReason = () => null;
  }
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

it('skips a step that is not set up here (no inbox) and still runs the rest', async () => {
  const emailIntake = require('../modules/email-intake/service');
  const apiReplyIntake = require('../modules/api-reply-intake/service');
  const { PipelineRunStep } = require('../db/models');
  emailIntake.notConfiguredReason = () => 'inbox not configured';
  apiReplyIntake.notConfiguredReason = () => 'inbox not configured';
  try {
    await pipelineService.executeSteps(runOf('API'));
  } finally {
    emailIntake.notConfiguredReason = () => null;
    apiReplyIntake.notConfiguredReason = () => null;
  }
  // No mailbox: both mail steps of the API pipeline are skipped (SYSTEM_4 go-live), every other step runs.
  expect(ran).toEqual(stepNames('API').filter((n) => n !== 'email-intake' && n !== 'api-reply-intake'));
  const skipped = await PipelineRunStep.create.mock.results.find((r, i) => PipelineRunStep.create.mock.calls[i][0].blockName === 'email-intake').value;
  expect(skipped.status).toBe('SKIPPED');
  expect(skipped.skipReason).toBe('inbox not configured');
  expect(jobLock.acquire).not.toHaveBeenCalledWith('email-intake');
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
  // SYSTEM_4 E4-01: a source switched off on the STP settings page never starts a run (cron or console).
  it('starts no run for a source that is switched off, and the other source still runs', async () => {
    const { Setting, PipelineRun } = require('../db/models');
    Setting.findAll.mockResolvedValueOnce([{ key: 'emailCasesEnabled', value: false }]);
    const res = await call(pipelineController, undefined);
    expect(res.body).toEqual({ block: 'pipeline', skipped: true, reason: 'source_disabled' });
    expect(PipelineRun.create).not.toHaveBeenCalled();
    expect(jobLock.acquire).not.toHaveBeenCalledWith('pipeline'); // (an earlier test's background run may still take step locks)

    Setting.findAll.mockResolvedValueOnce([{ key: 'emailCasesEnabled', value: false }]);
    const api = await call(pipelineController.apiPipeline, undefined);
    expect(api.body).toMatchObject({ block: 'api-pipeline', started: true });
    await new Promise((resolve) => setImmediate(resolve));
  });
});
