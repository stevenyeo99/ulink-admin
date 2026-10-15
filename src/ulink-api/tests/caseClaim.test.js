// Claiming a case (SYSTEM_4 E4-22, E4b): "Being reviewed by …" — others can view but not act; a claim lasts 30 minutes
// from the holder's last action; take-over needs a comment; the holder's override ends it; claim events never become
// the case page's "Next". Models are mocked (an in-memory mockClaims table).

const mockClaims = new Map();
jest.mock('../db/models', () => ({
  // writeClaim's conditional upsert, as Postgres runs it (insert, or update only when free / mine / expired / taken over).
  sequelize: {
    query: jest.fn(async (_sql, { replacements: r }) => {
      const cur = mockClaims.get(r.caseId);
      const mine = cur && cur.username === r.username;
      if (cur && !(mine || new Date(cur.expiresAt) <= r.now || cur.username === r.takeOverFrom)) return [[]];
      const row = { caseId: r.caseId, username: r.username, name: r.name, expiresAt: r.expiresAt,
        claimedAt: mine && new Date(cur.expiresAt) > r.now ? cur.claimedAt : r.claimedAt };
      mockClaims.set(r.caseId, row);
      return [[row]];
    }),
  },
  CaseClaim: {
    findByPk: jest.fn(async (id) => {
      const row = mockClaims.get(id);
      return row ? { ...row, update: jest.fn(async (patch) => mockClaims.set(id, { ...row, ...patch })) } : null;
    }),
    findAll: jest.fn(async ({ where }) => where.caseId.map((id) => mockClaims.get(id)).filter(Boolean)),
    update: jest.fn(async (patch, { where }) => { const row = mockClaims.get(where.caseId); if (row && row.username === where.username) mockClaims.set(where.caseId, { ...row, ...patch }); }),
    destroy: jest.fn(async ({ where }) => { if (mockClaims.get(where.caseId)?.username === where.username) mockClaims.delete(where.caseId); }),
  },
  CaseEvent: { create: jest.fn() },
}));

const { CaseEvent } = require('../db/models');
const c1 = { id: 'c1', currentStatus: 'INCOMPLETE' };
const { claimCase, releaseCase, endClaim, activeClaims, requireNotHeldByOther, CLAIM_MINUTES } = require('../modules/case-claim/claim');
const { nextAction } = require('../modules/assessment-summary/nextAction');

const ann = { username: 'ann', name: 'Ann' };
const bob = { username: 'bob', name: 'Bob' };
const t0 = new Date(); // the guard renews with the real clock, so the test's times start from it
const later = (minutes) => new Date(t0.getTime() + minutes * 60 * 1000);
const guard = async (user) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  const next = jest.fn();
  res.on = jest.fn();
  await requireNotHeldByOther({ params: { id: 'c1' }, user }, res, next);
  return { allowed: next.mock.calls.length === 1, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

beforeEach(() => { mockClaims.clear(); jest.clearAllMocks(); });

it('a claimed case: the holder acts, others are refused (409) but may still view it', async () => {
  expect(await claimCase(c1, ann, {}, t0)).toMatchObject({ claim: { username: 'ann', name: 'Ann' } });
  expect(CaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'CASE_CLAIMED', message: 'Being reviewed by Ann', newStatus: 'INCOMPLETE' }));
  expect((await guard(ann)).allowed).toBe(true);
  expect(await guard(bob)).toMatchObject({ allowed: false, status: 409, body: { error: { message: expect.stringContaining('Being reviewed by Ann') } } });
  expect(await claimCase(c1, bob, {}, t0)).toMatchObject({ status: 409 });
});

it('nobody holds it: anyone acts, as before', async () => {
  expect((await guard(bob)).allowed).toBe(true);
});

it(`expires ${CLAIM_MINUTES} minutes after the holder's last action`, async () => {
  await claimCase(c1, ann, {}, t0);
  expect((await activeClaims(['c1'], later(29))).get('c1')).toMatchObject({ username: 'ann' });
  expect((await activeClaims(['c1'], later(31))).get('c1')).toBeUndefined();
  expect(await claimCase(c1, bob, {}, later(31))).toMatchObject({ claim: { username: 'bob' } }); // free again

  // The holder acting renews it (the guard), and claiming again keeps the original start time.
  mockClaims.clear();
  await claimCase(c1, ann, {}, t0);
  const renewed = await claimCase(c1, ann, {}, later(20));
  expect(renewed.claim).toMatchObject({ claimedAt: t0, expiresAt: later(50) });
  expect(CaseEvent.create).toHaveBeenCalledTimes(3); // Ann, Bob after expiry, Ann again — renewing adds nothing
});

it('take over: only with a comment, kept in the case history', async () => {
  await claimCase(c1, ann, {}, t0);
  expect(await claimCase(c1, bob, { takeOver: true, comment: '' }, later(5))).toMatchObject({ status: 400 });
  expect(await claimCase(c1, bob, { takeOver: true, comment: 'Ann has gone home' }, later(5))).toMatchObject({ claim: { username: 'bob' } });
  expect(CaseEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ reasonCode: 'CASE_TAKEN_OVER', message: 'Taken over by Bob from Ann: Ann has gone home' }));
});

it('release: by the holder; the holder\'s override ends it too', async () => {
  await claimCase(c1, ann, {});
  expect(await releaseCase(c1, bob)).toMatchObject({ status: 409 });
  expect(await releaseCase(c1, ann)).toEqual({ released: true });
  expect(CaseEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ reasonCode: 'CASE_RELEASED' }));

  await claimCase(c1, ann, {});
  await endClaim('c1', 'ann');
  expect((await guard(bob)).allowed).toBe(true);
});

it('a claim never becomes the case page\'s "Next" message', () => {
  const fields = { currentStatus: 'INCOMPLETE' };
  const events = [
    { newStatus: 'INCOMPLETE', reasonCode: 'DOCUMENT_ISSUES_FOUND', message: 'Missing voucher(s)' },
    { newStatus: 'INCOMPLETE', reasonCode: 'CASE_CLAIMED', message: 'Being reviewed by Ann' },
  ];
  expect(JSON.stringify(nextAction(fields, null, events))).not.toContain('Being reviewed');
});

describe('code review 2026-10-15', () => {
  it('two people claiming at once: only one wins', async () => {
    const [a, b] = await Promise.all([claimCase(c1, ann, {}), claimCase(c1, bob, {})]);
    const winners = [a, b].filter((r) => r.claim);
    expect(winners).toHaveLength(1);
    expect([a, b].find((r) => !r.claim)).toMatchObject({ status: 409 });
  });

  it('an override ends only the overrider\'s own claim', async () => {
    await claimCase(c1, bob, {});
    await endClaim('c1', 'ann');
    expect((await activeClaims(['c1'])).get('c1')).toMatchObject({ username: 'bob' });
  });

  it('a finished case cannot be claimed; one waiting for JD3\'s approval can', async () => {
    expect(await claimCase({ id: 'c2', currentStatus: 'API_CSR_SENT' }, ann, {})).toMatchObject({ status: 400 });
    expect(await claimCase({ id: 'c3', currentStatus: 'CLAIM_CREATED' }, ann, {})).toMatchObject({ claim: { username: 'ann' } });
  });

  it('the holder\'s claim is renewed only when the action succeeded', async () => {
    await claimCase(c1, ann, {}, new Date(Date.now() - 20 * 60 * 1000)); // claimed 20 min ago: 10 min left
    const before = (await activeClaims(['c1'])).get('c1').expiresAt;
    for (const statusCode of [409, 200]) {
      const res = { statusCode, status: jest.fn(() => res), json: jest.fn(), on: jest.fn((_e, fn) => fn()) };
      await requireNotHeldByOther({ params: { id: 'c1' }, user: ann }, res, jest.fn());
      await new Promise((r) => setImmediate(r));
      const after = (await activeClaims(['c1'])).get('c1').expiresAt;
      if (statusCode === 409) expect(after).toEqual(before); else expect(after.getTime()).toBeGreaterThan(before.getTime());
    }
  });
});
