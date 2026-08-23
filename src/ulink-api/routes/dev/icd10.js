const express = require('express');
const { lookup } = require('../../controllers/dev/icd10Controller');
const router = express.Router();

/**
 * @openapi
 * /api/dev/icd10/lookup:
 *   post:
 *     tags: [dev]
 *     summary: Nearest-neighbor ICD-10 diagnosis candidates for free text (dev sanity check)
 *     description: >
 *       Embeds the given text (modules/icd10/embeddingClient.js) and returns the top-K
 *       nearest ICD-10 diagnoses from ulink_icd10_diagnoses by cosine similarity
 *       (modules/icd10/lookup.js). Requires the table to already be populated via
 *       scripts/ingestIcd10Diagnoses.js. Retrieval only — does not pick a single "best"
 *       code or write anything.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string }
 *               topK: { type: integer, default: 5 }
 *           example: { text: "Coughing dizziness" }
 *     responses:
 *       200:
 *         description: Top-K candidates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 text: { type: string }
 *                 candidates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       diagOid: { type: integer }
 *                       diagCode: { type: string }
 *                       diagDesc: { type: string }
 *                       similarity: { type: number }
 *       400:
 *         description: Missing/invalid "text"
 *       500:
 *         description: Embedding or DB error
 */
router.post('/lookup', lookup);

module.exports = router;
