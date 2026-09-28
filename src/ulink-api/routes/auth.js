const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { login, me } = require('../controllers/auth/authController');
const { requireAuth } = require('../modules/auth/auth');

const router = express.Router();

// Failed attempts only, per IP — slows password guessing without locking accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.auth.loginMax,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Wait 15 minutes and try again.', status: 429 } },
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [auth]
 *     summary: Console login — username + password → JWT (8 hours)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: "{ token, user: { id, username, name, role } }"
 *       401:
 *         description: Username or password is wrong
 *       429:
 *         description: Too many failed attempts
 */
router.post('/login', loginLimiter, login);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [auth]
 *     summary: The logged-in user (needs "Authorization: Bearer <token>")
 *     responses:
 *       200:
 *         description: "{ user: { id, username, name, role } }"
 *       401:
 *         description: Not logged in, or the token expired
 */
router.get('/me', requireAuth, me);

module.exports = router;
