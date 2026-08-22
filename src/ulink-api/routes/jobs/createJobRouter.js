const express = require('express');
const { createRunHandler, createReleaseHandler } = require('../../controllers/job/jobsController');

function createJobRouter(blockName, service) {
  const router = express.Router();
  router.post('/run', createRunHandler(blockName, service));
  router.post('/release', createReleaseHandler(blockName));
  return router;
}

module.exports = createJobRouter;
