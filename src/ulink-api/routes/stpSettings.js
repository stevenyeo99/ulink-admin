const express = require('express');
const { requireRole } = require('../modules/auth/auth');
const { getStpSettings, updateStpRule, addBlockedDiagnosis, removeBlockedDiagnosis } = require('../controllers/stp-settings/stpSettingsController');

const router = express.Router();

/**
 * @openapi
 * /api/stp-settings:
 *   get:
 *     tags: [stp-settings]
 *     summary: STP rules — per case type (EMAIL / API) and IAS benefit type, plus the never-STP diagnosis list
 *     responses:
 *       200:
 *         description: "{ rules: [{ id, caseSource, benefitType, currency, stpAllowed, amountLimit }], blockedDiagnoses: [{ id, codePrefix, note }] }"
 */
router.get('/', getStpSettings);

/**
 * @openapi
 * /api/stp-settings/rules/{id}:
 *   put:
 *     tags: [stp-settings]
 *     summary: Change one STP rule (super admin). Applies to claims prepared after the change.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stpAllowed, amountLimit]
 *             properties:
 *               stpAllowed: { type: boolean }
 *               amountLimit: { type: number, nullable: true }
 *     responses:
 *       200: { description: The updated rule }
 *       400: { description: Invalid value }
 *       404: { description: Rule not found }
 */
router.put('/rules/:id', requireRole('super_admin'), updateStpRule);

/**
 * @openapi
 * /api/stp-settings/blocked-diagnoses:
 *   post:
 *     tags: [stp-settings]
 *     summary: Add an ICD-10 code prefix that never goes STP (super admin)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [codePrefix]
 *             properties:
 *               codePrefix: { type: string, example: C50 }
 *               note: { type: string }
 *     responses:
 *       201: { description: Added }
 *       400: { description: Invalid or duplicate code }
 */
router.post('/blocked-diagnoses', requireRole('super_admin'), addBlockedDiagnosis);

/**
 * @openapi
 * /api/stp-settings/blocked-diagnoses/{id}:
 *   delete:
 *     tags: [stp-settings]
 *     summary: Remove a code prefix from the never-STP list (super admin)
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Not found }
 */
router.delete('/blocked-diagnoses/:id', requireRole('super_admin'), removeBlockedDiagnosis);

module.exports = router;
