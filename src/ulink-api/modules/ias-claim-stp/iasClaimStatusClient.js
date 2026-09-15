const config = require('../../config');

// Same AbortController-timeout discipline as every other external call in this codebase
// (see modules/ias-claim-creation/iasClaimClient.js) — must not be able to hang the job.
async function callIas({ path, body, accept }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.ias.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: accept },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS request to ${path} timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`IAS request to ${path} failed with status ${response.status}`);
  }

  return response;
}

/**
 * POST {IAS_URL}{CL_CLAIM_STATUS_API} — { claimNo, fromDatetime, compCodes } exact shape
 * verified against the real sample docs/imp/day1/IAS/ias_get_claim_status_request.json.
 * Returns the parsed body: { success: true, payload: { results: [...] } } — each results[]
 * row is one status-history entry for the claim; most have empty FILENAME/PATH, one gets
 * them once the settlement report exists (see modules/ias-claim-stp/service.js for the
 * matching rule).
 */
async function getClaimStatus({ claimNo, fromDatetime, compCodes = ['AYAS'] }) {
  if (!config.ias.baseUrl || !config.ias.claimStatusApi) {
    throw new Error('IAS_URL and CL_CLAIM_STATUS_API must be configured');
  }

  const response = await callIas({
    path: config.ias.claimStatusApi,
    body: { claimNo, fromDatetime, compCodes },
    accept: 'application/json',
  });

  return response.json();
}

/**
 * POST {IAS_URL}{CL_DOWNLOAD_FILE_API} — { filepath, filename }, Accept:
 * application/octet-stream. Returns the raw file bytes as a Buffer.
 */
async function downloadFile({ filepath, filename }) {
  if (!config.ias.baseUrl || !config.ias.downloadFileApi) {
    throw new Error('IAS_URL and CL_DOWNLOAD_FILE_API must be configured');
  }

  const response = await callIas({
    path: config.ias.downloadFileApi,
    body: { filepath, filename },
    accept: 'application/octet-stream',
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { getClaimStatus, downloadFile };
