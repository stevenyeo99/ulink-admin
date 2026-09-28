const { User } = require('../../db/models');
const { hashPassword, verifyPassword, signToken } = require('../../modules/auth/auth');
const logger = require('../../utils/logger');

const WRONG = { error: { message: 'Username or password is wrong.', status: 401 } };
// Checked when the username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password');

const publicUser = (user) => ({ id: user.id, username: user.username, name: user.name, role: user.role });

/** POST /api/auth/login — { username, password } → { token, user }. */
async function login(req, res) {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: { message: 'Enter your username and password.', status: 400 } });
  }

  const user = await User.findOne({ where: { username } });
  const ok = await verifyPassword(password, user ? user.passwordHash : await DUMMY_HASH);
  if (!user || !ok || !user.isActive) {
    logger.warn('Console login refused', { username, reason: !user ? 'unknown user' : !ok ? 'wrong password' : 'inactive' });
    return res.status(401).json(WRONG);
  }

  await user.update({ lastLoginAt: new Date() });
  logger.info('Console login', { username });
  return res.json({ token: signToken(user), user: publicUser(user) });
}

/** GET /api/auth/me — the logged-in user, from their token. */
function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, me, publicUser };
