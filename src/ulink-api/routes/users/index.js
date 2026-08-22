const express = require('express');
const { listUsers } = require('../../controllers/users/usersController');
const router = express.Router();

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [users]
 *     summary: List users (scaffold — always returns an empty array today)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: {} }
 *             example:
 *               data: []
 */
router.get('/', listUsers);

module.exports = router;
