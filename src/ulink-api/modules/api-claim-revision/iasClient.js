const config = require('../../config');

/**
 * POST {IAS_URL}{CL_CLAIM_REVISION_API} with the prepared revision body (the CL_CLAIM_API payload
 * plus claimNo — docs/imp/demo/API DAY1/IAS_CLAIM_REVISION.md). Same shape and timeout
 * discipline as modules/ias-claim-creation/iasClaimClient.js, and IAS answers the same way:
 * { success: true, payload } or { success: false, error } is returned as-is (a real business
 * answer); a network error, timeout or non-2xx status throws (technical — retry).
 */
async function reviseClaim(payload) {
  if (!config.ias.baseUrl || !config.ias.claimRevisionApi) {
    throw new Error('IAS_URL and CL_CLAIM_REVISION_API must be configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.ias.baseUrl}${config.ias.claimRevisionApi}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS claim revision request timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`IAS claim revision request failed with status ${response.status}`);
  }
  return response.json();
}

module.exports = { reviseClaim };
