const express = require('express');
const { getRoot } = require('../../controllers/meta/metaController');
const router = express.Router();

/**
 * @openapi
 * /:
 *   get:
 *     tags: [meta]
 *     summary: Service identity check
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name: { type: string }
 *                 message: { type: string }
 *             example:
 *               name: ulink-api
 *               message: Welcome to ULINK API
 */
router.get('/', getRoot);

module.exports = router;
