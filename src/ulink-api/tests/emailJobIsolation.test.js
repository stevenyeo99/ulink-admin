const { Op } = require('sequelize');

// Email jobs must never pick up an API case (docs/imp/day1/api-case-workflow.md section 3,
// rule 3). They don't filter on `source`; they rely on selecting exact email statuses, which
// the DB check makes impossible for an API case. This test runs every email job's run() with
// Case.findAll mocked and fails if any job selects without a currentStatus filter, or with a
// filter that could match an API_ status — i.e. if a future edit would let it see API cases.
// No DB, no network: findAll returns no cases, so no job gets past selection.

jest.mock('../db/models', () => {
  const findAll = jest.fn().mockResolvedValue([]);
  return new Proxy(
    {
      Case: { findAll },
      Sequelize: jest.requireActual('sequelize'),
      sequelize: { transaction: jest.fn() },
      // claim-recognition stops before selecting cases when no route is enabled.
      ClaimRoute: { findAll: jest.fn().mockResolvedValue([{ key: 'test_route', enabled: true }]) },
    },
    // Any other model a service imports: an object whose methods resolve to nothing.
    { get: (target, key) => target[key] ?? new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) }) }
  );
});

const { Case } = require('../db/models');

const EMAIL_JOBS = {
  'claim-recognition': '../modules/claim-recognition/service',
  'member-verification': '../modules/member-verification/service',
  'document-checking': '../modules/document-checking/service',
  'console-upload': '../modules/console-upload/service',
  'ias-claim-preparation': '../modules/ias-claim-preparation/service',
  'ias-claim-creation': '../modules/ias-claim-creation/service',
  'ias-claim-stp': '../modules/ias-claim-stp/service',
};

// currentStatus may be 'X', ['X', 'Y'] or { [Op.in]: [...] }; anything else (Op.like, Op.ne, ...)
// could match an API_ status and is reported as unsupported.
function selectedStatuses(where) {
  const status = where && where.currentStatus;
  if (typeof status === 'string') return [status];
  if (Array.isArray(status)) return status;
  if (status && Array.isArray(status[Op.in]) && Object.getOwnPropertySymbols(status).length === 1) return status[Op.in];
  return null;
}

describe.each(Object.entries(EMAIL_JOBS))('%s', (name, modulePath) => {
  beforeEach(() => Case.findAll.mockClear());

  it('selects cases only by exact, non-API email statuses', async () => {
    await require(modulePath).run();

    expect(Case.findAll).toHaveBeenCalled();
    for (const [query] of Case.findAll.mock.calls) {
      const statuses = selectedStatuses(query && query.where);
      expect(statuses).not.toBeNull();
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) expect(status).not.toMatch(/^API_/);
    }
  });
});

describe('selectedStatuses guard', () => {
  it('reports filters that could match an API case', () => {
    expect(selectedStatuses(undefined)).toBeNull();
    expect(selectedStatuses({ recognizedType: 'x' })).toBeNull();
    expect(selectedStatuses({ currentStatus: { [Op.like]: '%' } })).toBeNull();
    expect(selectedStatuses({ currentStatus: { [Op.ne]: 'INCOMPLETE' } })).toBeNull();
  });

  it('reads exact status filters in every supported shape', () => {
    expect(selectedStatuses({ currentStatus: 'INCOMPLETE' })).toEqual(['INCOMPLETE']);
    expect(selectedStatuses({ currentStatus: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(selectedStatuses({ currentStatus: { [Op.in]: ['A'] } })).toEqual(['A']);
  });
});

// The two orchestrators stay separate (modules/pipeline/service.js): the email pipeline never
// runs an API job, and the API pipeline only runs API jobs (plus, from Phase 4, the shared
// email-intake / email-sender — add them to SHARED when they join).
describe('pipeline step lists', () => {
  const { STEPS, API_STEPS, PIPELINES } = require('../modules/pipeline/service');
  const SHARED = ['email-intake'];

  it('keeps the email pipeline free of API jobs, and the same list as before', () => {
    expect(PIPELINES.EMAIL).toBe(STEPS);
    expect(STEPS.map(([name]) => name).filter((name) => name.startsWith('api-'))).toEqual([]);
  });

  it('runs only API jobs in the API pipeline', () => {
    expect(PIPELINES.API).toBe(API_STEPS);
    for (const [name] of API_STEPS) expect(name.startsWith('api-') || SHARED.includes(name)).toBe(true);
  });
});
