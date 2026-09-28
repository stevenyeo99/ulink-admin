// Console login (modules/auth/auth.js, controllers/auth/authController.js): passwords, tokens, role
// checks, the login endpoint, and which routes need a logged-in user. The User model is mocked.

process.env.JWT_SECRET = 'test-secret-for-jwt';

jest.mock('../db/models', () => {
  const actual = jest.requireActual('../db/models');
  return { ...actual, User: { findOne: jest.fn() } };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { User } = require('../db/models');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../modules/auth/auth');
const app = require('../app');

const superAdmin = { id: 'u1', username: 'ulink', name: 'Ulink', role: 'super_admin' };
const bearer = (user = superAdmin) => `Bearer ${signToken(user)}`;

beforeEach(() => jest.clearAllMocks());

describe('passwords', () => {
  it('verifies the right password only, with a different salt every time', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('tokens', () => {
  it('round-trips the user and rejects forged or expired tokens', () => {
    expect(verifyToken(signToken(superAdmin))).toEqual(superAdmin);
    expect(verifyToken(jwt.sign({ sub: 'u1', role: 'super_admin' }, 'someone-elses-secret'))).toBeNull();
    const expired = jwt.sign({ sub: 'u1', role: 'super_admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    expect(verifyToken(expired)).toBeNull();
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for the right username and password (username not case-sensitive)', async () => {
    const update = jest.fn();
    User.findOne.mockResolvedValue({ ...superAdmin, isActive: true, passwordHash: await hashPassword('s3cret-pass'), update });

    const res = await request(app).post('/api/auth/login').send({ username: ' ULINK ', password: 's3cret-pass' });

    expect(res.status).toBe(200);
    expect(User.findOne).toHaveBeenCalledWith({ where: { username: 'ulink' } });
    expect(res.body.user).toEqual(superAdmin);
    expect(verifyToken(res.body.token)).toEqual(superAdmin);
    expect(update).toHaveBeenCalledWith({ lastLoginAt: expect.any(Date) });
  });

  it('gives the same answer for a wrong password, an unknown user and a disabled user', async () => {
    const passwordHash = await hashPassword('s3cret-pass');
    User.findOne.mockResolvedValueOnce({ ...superAdmin, isActive: true, passwordHash });
    const wrongPassword = await request(app).post('/api/auth/login').send({ username: 'ulink', password: 'nope-nope' });
    User.findOne.mockResolvedValueOnce(null);
    const unknownUser = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 's3cret-pass' });
    User.findOne.mockResolvedValueOnce({ ...superAdmin, isActive: false, passwordHash });
    const disabled = await request(app).post('/api/auth/login').send({ username: 'ulink', password: 's3cret-pass' });

    for (const res of [wrongPassword, unknownUser, disabled]) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Username or password is wrong.');
    }
  });
});

describe('route protection', () => {
  it('needs a valid token for cases, users and dev tools', async () => {
    for (const path of ['/api/cases/statuses', '/api/users', '/api/dev/cases/reset', '/api/auth/me']) {
      const res = await request(app).get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
    expect((await request(app).get('/api/cases/statuses').set('Authorization', 'Bearer forged.token.here')).status).toBe(401);
  });

  it('lets a logged-in user through, and tells the console who they are', async () => {
    expect((await request(app).get('/api/cases/statuses').set('Authorization', bearer())).status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', bearer());
    expect(me.body.user).toEqual(superAdmin);
  });

  it('keeps admin-only routes to super admins', async () => {
    const other = bearer({ ...superAdmin, role: 'csr' });
    expect((await request(app).get('/api/users').set('Authorization', other)).status).toBe(403);
    expect((await request(app).post('/api/cases/x/reset').set('Authorization', other)).status).toBe(403);
  });

  it('leaves pipeline / job routes open for cron', async () => {
    const res = await request(app).get('/api/jobs/pipeline/runs?limit=1');
    expect(res.status).not.toBe(401);
  });
});
