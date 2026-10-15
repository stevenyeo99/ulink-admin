// "Next case" in the review workspace (SYSTEM_4 E4-20, E5a): the oldest case in the review queue that isn't the one
// just reviewed and isn't being reviewed by someone else. Models are mocked.

jest.mock('../db/models', () => ({
  Case: { findAll: jest.fn() },
  CaseEvent: { findAll: jest.fn(async () => []) },
  ApiCaseStep: { findAll: jest.fn(async () => []) },
  CaseClaim: { findAll: jest.fn(async () => []) },
  Setting: { findAll: jest.fn(async () => []) },
  CaseDocument: {}, EmailThread: {}, EmailMessage: {}, EmailAttachment: {},
}));

const { Case, CaseClaim } = require('../db/models');
const { getNextCase } = require('../controllers/cases/casesController');

// An email case held for a person ("Check before emailing customer"): always in the review queue.
const held = (id, minutesAgo) => ({
  id, source: 'EMAIL', currentStatus: 'DOCUMENTS_REVIEW', updatedAt: new Date(Date.now() - minutesAgo * 60000),
  documentCheckResult: { passed: false, issues: ['Missing voucher(s)'], details: [], checklist: [{ code: 'MISSING_VOUCHER', label: 'Missing voucher(s)', passed: false }] },
});
const next = async (query, username = 'ann') => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await getNextCase({ query, user: { username } }, res);
  return res.json.mock.calls[0][0];
};
const future = new Date(Date.now() + 10 * 60000);

beforeEach(() => {
  jest.clearAllMocks();
  Case.findAll.mockResolvedValue([held('a', 30), held('b', 20), held('c', 10)]); // oldest first, as the query orders
});

it('walks down the queue from the case just reviewed, wrapping round — never bouncing between the two oldest', async () => {
  expect(await next({})).toEqual({ id: 'a' });
  expect(await next({ after: 'a' })).toEqual({ id: 'b' });
  expect(await next({ after: 'b' })).toEqual({ id: 'c' });
  expect(await next({ after: 'c' })).toEqual({ id: 'a' });
  expect(await next({ after: 'gone' })).toEqual({ id: 'a' }); // decided meanwhile: from the oldest
});

it('skips a case someone else is reviewing, but not my own', async () => {
  CaseClaim.findAll.mockResolvedValue([
    { caseId: 'a', username: 'bob', expiresAt: future, claimedAt: new Date() },
    { caseId: 'b', username: 'ann', expiresAt: future, claimedAt: new Date() },
  ]);
  expect(await next({})).toEqual({ id: 'b' });
});

it('null when nothing is left', async () => {
  Case.findAll.mockResolvedValue([held('a', 30)]);
  expect(await next({ after: 'a' })).toEqual({ id: null });
});
