const express = require('express');
const { apiReviewPipeline } = require('../../controllers/job/pipelineController');

// The API review lane (SYSTEM_5): POST /run starts it (the retry cron, no body), or asks a busy lane to run once more.
const router = express.Router();

router.post('/run', apiReviewPipeline.runPipeline);
router.post('/release', apiReviewPipeline.releasePipeline);
router.get('/runs', apiReviewPipeline.listRuns);
router.get('/runs/:id', apiReviewPipeline.getRun);

module.exports = router;
