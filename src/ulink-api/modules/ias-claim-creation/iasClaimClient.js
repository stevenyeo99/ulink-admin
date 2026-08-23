const config = require('../../config');

/**
 * POST {IAS_URL}{CL_CLAIM_API} with the prepared claim payload (Case.iasClaimPayload) — no
 * auth header, same confirmed shape as modules/member-verification/iasClient.js. Explicit
 * AbortController timeout, same discipline as every other external call in this codebase —
 * must not be able to hang the job.
 *
 * Returns the parsed body as-is: { success: true, payload: { claimNo, ... } } or
 * { success: false, error: "..." } (verified against the real sample in
 * docs/imp/day1/IAS/ias_claim_submission_api.json, including its error-response shape).
 * A non-2xx HTTP status still throws (genuine technical failure — retry); a 200 response
 * with `success: false` is returned normally — that's a real business answer from IAS
 * (e.g. "Claim already exists"), not a technical failure, and the caller must not treat it
 * as one. See modules/ias-claim-creation/service.js for how the two are told apart.
 */
async function submitClaim(payload) {
  if (!config.ias.baseUrl || !config.ias.claimApi) {
    throw new Error('IAS_URL and CL_CLAIM_API must be configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.ias.baseUrl}${config.ias.claimApi}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS claim submission request timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`IAS claim submission request failed with status ${response.status}`);
  }

  return response.json();
}

module.exports = { submitClaim };
