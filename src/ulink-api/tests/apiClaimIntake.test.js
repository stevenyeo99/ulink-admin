// api-claim-intake: date ranges (explicit and scheduled catch-up), and run()'s no-duplicate /
// failure handling. No DB or network: IAS is mocked, and Case.findOrCreate is backed by an
// in-memory store that enforces the same uniqueness as the real indexes (claim_no,
// tpa_case_number among API cases). The real constraints are covered by
// tests/caseSourceConstraint.test.js; the real IAS call by the dev preview endpoint.

jest.mock('../modules/api-claim-intake/iasClient', () => ({ listApiClaims: jest.fn() }));
jest.mock('../db/models', () => {
  const store = new Map(); // claimNo -> case
  const checkpoint = { value: null };
  return {
    store,
    checkpoint,
    sequelize: { transaction: (fn) => fn({}) },
    CaseEvent: { create: jest.fn().mockResolvedValue({}) },
    ApiCaseStep: { create: jest.fn().mockResolvedValue({}) },
    JobCheckpoint: {
      findByPk: jest.fn(async () => (checkpoint.value ? { value: checkpoint.value } : null)),
      upsert: jest.fn(async ({ value }) => { checkpoint.value = value; }),
    },
    Case: {
      findOrCreate: jest.fn(async ({ where, defaults }) => {
        if (store.has(where.claimNo)) return [store.get(where.claimNo), false];
        if ([...store.values()].some((c) => c.tpaCaseNumber === defaults.tpaCaseNumber)) {
          throw new Error('duplicate key value violates unique constraint "ulink_cases_api_tpa_case_number_unique"');
        }
        const created = { id: `case-${store.size + 1}`, ...defaults };
        store.set(where.claimNo, created);
        return [created, true];
      }),
    },
  };
});

const { resolveDateRange, run } = require('../modules/api-claim-intake/service');
const { listApiClaims } = require('../modules/api-claim-intake/iasClient');
const models = require('../db/models');
const { todayInIasTimezone } = require('../modules/shared/iasDates');

describe('todayInIasTimezone', () => {
  it('uses Myanmar time (UTC+6:30), not the server clock', () => {
    // 2026-09-23 17:45 UTC = 2026-09-24 00:15 in Myanmar.
    expect(todayInIasTimezone(new Date('2026-09-23T17:45:00Z'))).toBe('2026-09-24');
    // 2026-09-23 17:15 UTC = 2026-09-23 23:45 in Myanmar (already the 24th on a UTC+7 server).
    expect(todayInIasTimezone(new Date('2026-09-23T17:15:00Z'))).toBe('2026-09-23');
  });
});

describe('resolveDateRange (explicit ranges)', () => {
  const today = todayInIasTimezone();

  it('defaults both bounds to today when none are given', () => {
    expect(resolveDateRange()).toEqual({ dateFrom: today, dateTo: today });
  });

  it('keeps an explicit range', () => {
    expect(resolveDateRange({ dateFrom: '2026-06-30', dateTo: '2026-07-02' }))
      .toEqual({ dateFrom: '2026-06-30', dateTo: '2026-07-02' });
  });

  it('defaults only the missing bound to today', () => {
    expect(resolveDateRange({ dateFrom: '2026-06-30' })).toEqual({ dateFrom: '2026-06-30', dateTo: today });
  });

  it('rejects a wrong format or an impossible date', () => {
    expect(resolveDateRange({ dateFrom: '30-06-2026', dateTo: '2026-06-30' }).error).toBeDefined();
    expect(resolveDateRange({ dateFrom: '2026-02-30', dateTo: '2026-03-01' }).error).toBeDefined();
  });

  it('rejects dateFrom after dateTo', () => {
    expect(resolveDateRange({ dateFrom: '2026-07-02', dateTo: '2026-06-30' }).error).toMatch(/must not be after/);
  });
});

describe('run', () => {
  const today = todayInIasTimezone();
  const claim = (clNo, tpaCaseNumber) => ({ clNo, tpaCaseNumber, crtDate: '2026-06-30T14:50:18' });
  const iasReturns = (claims) => listApiClaims.mockResolvedValue({ success: true, payload: { claims } });

  beforeEach(() => {
    models.store.clear();
    models.checkpoint.value = null;
    jest.clearAllMocks();
  });

  it('creates one API_RECEIVED case per claim, with its step output and an event', async () => {
    iasReturns([claim('2604050015', 'STEVENEVERHILLC58'), claim('2604050016', 'STEVENEVERHILLC688')]);

    const summary = await run();

    expect(summary).toMatchObject({ fetched: 2, inserted: 2, skippedExisting: 0, errors: [] });
    expect(models.store.get('2604050015')).toMatchObject({
      source: 'API', currentStatus: 'API_RECEIVED', tpaCaseNumber: 'STEVENEVERHILLC58',
    });
    // The step row is what api-material-download receives as its input.
    expect(models.ApiCaseStep.create).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-1',
      job: 'api-claim-intake',
      status: 'DONE',
      output: { clNo: '2604050015', tpaCaseNumber: 'STEVENEVERHILLC58', crtDate: '2026-06-30T14:50:18' },
    }), expect.anything());
    expect(models.CaseEvent.create).toHaveBeenCalledTimes(2);
  });

  it('lists today on a first run and remembers it', async () => {
    iasReturns([]);
    await run();
    expect(listApiClaims).toHaveBeenCalledWith({ dateFrom: today, dateTo: today });
    expect(models.checkpoint.value).toEqual({ lastListedDate: today });
  });

  it('catches up every day since the last successful run (e.g. after an outage)', async () => {
    models.checkpoint.value = { lastListedDate: '2026-06-28' };
    iasReturns([]);
    await run();
    expect(listApiClaims).toHaveBeenCalledWith({ dateFrom: '2026-06-28', dateTo: today });
    expect(models.checkpoint.value).toEqual({ lastListedDate: today });
  });

  it('creates nothing new when the same list comes back again', async () => {
    iasReturns([claim('2604050015', 'STEVENEVERHILLC58')]);
    await run();
    models.store.get('2604050015').currentStatus = 'API_MATERIALS_DOWNLOADED'; // moved on by a later job

    const second = await run();

    expect(second).toMatchObject({ inserted: 0, skippedExisting: 1 });
    expect(models.store.size).toBe(1);
    expect(models.store.get('2604050015').currentStatus).toBe('API_MATERIALS_DOWNLOADED');
    expect(models.ApiCaseStep.create).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and keeps the checkpoint when IAS fails or answers success:false', async () => {
    models.checkpoint.value = { lastListedDate: '2026-06-28' };
    listApiClaims.mockRejectedValue(new Error('IAS claim list request timed out after 30000ms'));
    await expect(run()).rejects.toThrow(/timed out/);

    listApiClaims.mockResolvedValue({ success: false, error: 'bad request' });
    await expect(run()).rejects.toThrow(/bad request/);

    expect(models.store.size).toBe(0);
    expect(models.checkpoint.value).toEqual({ lastListedDate: '2026-06-28' });
  });

  it('skips an invalid row and reports a clash without blocking the rest', async () => {
    iasReturns([
      { clNo: '', tpaCaseNumber: 'NO-CLNO' },
      claim('2604050015', 'STEVENEVERHILLC58'),
      claim('2604059999', 'STEVENEVERHILLC58'), // same tpaCaseNumber under a new clNo
      claim('2604050016', 'STEVENEVERHILLC688'),
    ]);

    const summary = await run();

    expect(summary).toMatchObject({ fetched: 4, inserted: 2, skippedInvalid: 1 });
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[1]).toMatchObject({ clNo: '2604059999', error: expect.stringMatching(/tpa_case_number/) });
  });

  it('uses an explicit range as given and leaves the checkpoint alone', async () => {
    iasReturns([]);
    await run({ dateFrom: '2026-06-30', dateTo: '2026-06-30' });
    expect(listApiClaims).toHaveBeenCalledWith({ dateFrom: '2026-06-30', dateTo: '2026-06-30' });
    expect(models.JobCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid explicit range before calling IAS', async () => {
    await expect(run({ dateFrom: '2026-07-02', dateTo: '2026-06-30' })).rejects.toThrow(/must not be after/);
    expect(listApiClaims).not.toHaveBeenCalled();
  });
});
