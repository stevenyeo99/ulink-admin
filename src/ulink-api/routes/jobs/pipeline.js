const express = require('express');
const { runPipeline, releasePipeline, listRuns, getRun } = require('../../controllers/job/pipelineController');

const router = express.Router();

/**
 * @openapi
 * /api/jobs/pipeline/run:
 *   post:
 *     tags: [jobs]
 *     summary: Run all 7 block jobs in order (fire-and-forget)
 *     description: >
 *       Consolidates every individual /api/jobs/<block>/run endpoint into one call, for
 *       end-to-end testing and as the eventual single crontab entry — each block's own
 *       endpoint stays live too, for re-running one stage in isolation. Order:
 *       email-intake, claim-recognition, document-checking, member-verification,
 *       email-sender, ias-claim-preparation, ias-claim-creation. Guarded by its own
 *       'pipeline' job lock so two triggers can't produce two concurrent runs; each step
 *       inside also acquires that block's own per-block lock, so a step whose block is
 *       individually locked by a concurrent cron trigger is SKIPPED (not an error) rather
 *       than blocking. A step that throws is marked FAILED but does not stop the
 *       remaining steps — see docs/imp/day1/jobs-registry.md's Orchestrator section.
 *       Responds immediately with the new run's id; poll GET .../runs/{id} for progress
 *       and per-step results.
 *     requestBody:
 *       required: false
 *       description: No body needed — trigger only.
 *     responses:
 *       200:
 *         description: Started, or skipped because a prior run is still in progress
 *         content:
 *           application/json:
 *             examples:
 *               started:
 *                 value: { block: pipeline, started: true, runId: "9f7ae69f-uuid" }
 *               skipped:
 *                 value: { block: pipeline, skipped: true, reason: already_running }
 *
 * /api/jobs/pipeline/release:
 *   post:
 *     tags: [jobs]
 *     summary: Manually clear a stuck pipeline lock
 *     description: >
 *       Same idempotent shape as every other block's /release. Also marks the most recent
 *       still-RUNNING pipeline run (and any of its still-pending/running steps) FAILED, so
 *       a manual release doesn't leave an orphaned run row behind. A process restart
 *       already reconciles stale runs automatically (modules/pipeline/reconcile.js) — this
 *       endpoint is for the case where the process itself is still up but got stuck.
 *     requestBody:
 *       required: false
 *     responses:
 *       200:
 *         description: Lock cleared
 *
 * /api/jobs/pipeline/runs:
 *   get:
 *     tags: [jobs]
 *     summary: List recent pipeline runs, newest first
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Recent runs
 *
 * /api/jobs/pipeline/runs/{id}:
 *   get:
 *     tags: [jobs]
 *     summary: One pipeline run with its steps, in execution order
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The run and its steps
 *       404:
 *         description: No run with that id
 */
router.post('/run', runPipeline);
router.post('/release', releasePipeline);
router.get('/runs', listRuns);
router.get('/runs/:id', getRun);

module.exports = router;
