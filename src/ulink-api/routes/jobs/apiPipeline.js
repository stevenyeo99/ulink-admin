const express = require('express');
const { apiPipeline } = require('../../controllers/job/pipelineController');

const router = express.Router();

/**
 * @openapi
 * /api/jobs/api-pipeline/run:
 *   post:
 *     tags: [jobs]
 *     summary: Start the API case orchestrator (fire-and-forget)
 *     description: >
 *       Runs the API case jobs in order (modules/pipeline/service.js API_STEPS — currently
 *       api-claim-intake, then api-material-download) as one PipelineRun with pipeline=API.
 *       Separate from the email orchestrator (/api/jobs/pipeline) and its own lock, so the two
 *       never block each other. Schedule: every 30 minutes. See
 *       docs/imp/day1/api-case-workflow.md section 5.
 *     requestBody:
 *       required: false
 *       description: >
 *         Optional. { "steps": ["<step name>"] } runs only those steps of this pipeline (in pipeline
 *         order) as a normal run — for debugging one job from the console. Omit to run every step.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               steps: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Started (with runId), or skipped because a prior API run is still in progress
 *         content:
 *           application/json:
 *             examples:
 *               started:
 *                 value: { block: api-pipeline, started: true, runId: "3f2a1b7e-uuid" }
 *               skipped:
 *                 value: { block: api-pipeline, skipped: true, reason: already_running }
 *
 * /api/jobs/api-pipeline/release:
 *   post:
 *     tags: [jobs]
 *     summary: Clear a stuck api-pipeline lock and fail its orphaned RUNNING run
 *     responses:
 *       200:
 *         description: Lock cleared
 *
 * /api/jobs/api-pipeline/runs:
 *   get:
 *     tags: [jobs]
 *     summary: Recent API pipeline runs, newest first
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: "{ runs: [...] } — API runs only"
 *
 * /api/jobs/api-pipeline/runs/{id}:
 *   get:
 *     tags: [jobs]
 *     summary: One API pipeline run with its steps
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The run and its steps
 *       404:
 *         description: No API run with that id
 */
router.post('/run', apiPipeline.runPipeline);
router.post('/release', apiPipeline.releasePipeline);
router.get('/runs', apiPipeline.listRuns);
router.get('/runs/:id', apiPipeline.getRun);

module.exports = router;
