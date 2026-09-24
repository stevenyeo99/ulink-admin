const express = require('express');
const { previewClaims } = require('../../controllers/dev/apiClaimIntakeController');
const router = express.Router();

/**
 * @openapi
 * /api/dev/api-claim-intake/preview:
 *   get:
 *     tags: [dev]
 *     summary: List IAS API claims for a date range (real IAS call, zero persistence)
 *     description: >
 *       Calls the real IAS get_claim_api and returns its claims unchanged. Nothing is written
 *       to the DB. Either date omitted defaults to today in Myanmar time (UTC+6:30), which is
 *       also what the scheduled job uses.
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date, example: "2026-06-30" }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date, example: "2026-06-30" }
 *     responses:
 *       200:
 *         description: Claims created through the IAS API in the range
 *         content:
 *           application/json:
 *             example:
 *               dryRun: true
 *               dateFrom: "2026-06-30"
 *               dateTo: "2026-06-30"
 *               total: 1
 *               claims:
 *                 - clNo: "2604050015"
 *                   tpaCaseNumber: "STEVENEVERHILLC58"
 *                   crtDate: "2026-06-30T14:50:18"
 *       400:
 *         description: Invalid date, or dateFrom after dateTo
 *       502:
 *         description: IAS failed, timed out, or returned success=false
 */
router.get('/preview', previewClaims);

module.exports = router;
