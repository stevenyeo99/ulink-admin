const express = require('express');
const { emailReviewPipeline } = require('../../controllers/job/pipelineController');

// The email review lane (SYSTEM_5): POST /run starts it (the retry cron, no body), or asks a busy lane to run once more.
const router = express.Router();

router.post('/run', emailReviewPipeline.runPipeline);
router.post('/release', emailReviewPipeline.releasePipeline);
router.get('/runs', emailReviewPipeline.listRuns);
router.get('/runs/:id', emailReviewPipeline.getRun);

module.exports = router;
