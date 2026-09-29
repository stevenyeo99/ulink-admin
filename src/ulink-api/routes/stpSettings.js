const express = require('express');
const { requireRole } = require('../modules/auth/auth');
const { getStpSettings, saveStpSettings } = require('../controllers/stp-settings/stpSettingsController');

const router = express.Router();

/**
 * @openapi
 * /api/stp-settings:
 *   get:
 *     tags: [stp-settings]
 *     summary: STP settings — rules per case type (EMAIL / API) and IAS benefit type, never-STP diagnoses, human-check switches
 *     responses:
 *       200:
 *         description: "{ rules: [{ id, caseSource, benefitType, currency, stpAllowed, amountLimit }], blockedDiagnoses: [{ id, codePrefix, note }], switches: { stpBlockOnReviewPoints, holdUnsureMissingDocsEmail } }"
 *   put:
 *     tags: [stp-settings]
 *     summary: Save the whole STP settings form (super admin) — all or nothing
 *     description: >
 *       The console's one Save. rules — the rules to change; blockedDiagnoses — the complete never-STP list
 *       (codes left out are removed); switches — the switches to set. Any error → nothing is saved and every
 *       problem is returned in error.errors. Applies to claims prepared after the save.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rules:
 *                 type: array
 *                 items: { type: object, properties: { id: { type: string }, stpAllowed: { type: boolean }, amountLimit: { type: number, nullable: true } } }
 *               blockedDiagnoses:
 *                 type: array
 *                 items: { type: object, properties: { codePrefix: { type: string, example: C50 }, note: { type: string } } }
 *               switches:
 *                 type: object
 *                 properties: { stpBlockOnReviewPoints: { type: boolean }, holdUnsureMissingDocsEmail: { type: boolean } }
 *     responses:
 *       200: { description: The settings after the save (same shape as GET) }
 *       400: { description: "Invalid form — nothing saved; error.errors lists every problem" }
 */
router.get('/', getStpSettings);
router.put('/', requireRole('super_admin'), saveStpSettings);

module.exports = router;
