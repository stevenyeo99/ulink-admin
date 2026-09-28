const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const config = require('../../config');

// Console login (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, step 7): username +
// password, then a signed JWT the console sends as "Authorization: Bearer …".

const ROLES = ['super_admin'];
const MIN_PASSWORD_LENGTH = 8;
const TOKEN_TTL = '8h';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// Stored as "scrypt$<salt hex>$<hash hex>" — Node's built-in scrypt, a random salt per password.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function jwtSecret() {
  if (!config.auth.jwtSecret) throw new Error('JWT_SECRET is not configured');
  return config.auth.jwtSecret;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name, role: user.role }, jwtSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
  });
}

/** The token's user ({ id, username, name, role }), or null if it's missing, forged or expired. */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    return { id: payload.sub, username: payload.username, name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}

/** Every route behind it needs a valid token; the user is on req.user. */
function requireAuth(req, res, next) {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  const user = scheme === 'Bearer' && token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: { message: 'Log in to continue.', status: 401 } });
  req.user = user;
  return next();
}

/** Only these roles may continue (after requireAuth). */
function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({ error: { message: "Your role can't do this.", status: 403 } });
}

module.exports = { ROLES, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword, signToken, verifyToken, requireAuth, requireRole };
