const express = require('express');
const { getHealth } = require('../../controllers/meta/metaController');
const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [meta]
 *     summary: Liveness probe
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string }
 *                 uptime: { type: number, description: Process uptime in seconds }
 *                 timestamp: { type: string, format: date-time }
 *             example:
 *               status: ok
 *               uptime: 123.45
 *               timestamp: "2026-08-22T03:00:00.000Z"
 */
router.get('/', getHealth);

module.exports = router;
