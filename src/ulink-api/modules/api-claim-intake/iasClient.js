const config = require('../../config');

/**
 * GET {IAS_URL}{GET_CLAIM_API}?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD — claims created in IAS
 * through its API in that date range (sample: docs/imp/demo/API DAY1/1. GET_LIST_API_IAS.md).
 * No auth header, same as every other IAS call here. Same AbortController-timeout discipline
 * as modules/ias-claim-creation/iasClaimClient.js — must not be able to hang the job.
 *
 * Returns the parsed body as-is ({ success, payload: { claims: [...] } } or
 * { success: false, error }); a non-2xx status throws.
 */
async function listApiClaims({ dateFrom, dateTo }) {
  if (!config.ias.baseUrl || !config.ias.claimListApi) {
    throw new Error('IAS_URL and GET_CLAIM_API must be configured');
  }

  const query = new URLSearchParams({ dateFrom, dateTo });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.ias.baseUrl}${config.ias.claimListApi}?${query}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS claim list request timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`IAS claim list request failed with status ${response.status}`);
  }

  return response.json();
}

module.exports = { listApiClaims };
