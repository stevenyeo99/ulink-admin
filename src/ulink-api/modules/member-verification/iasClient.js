const config = require('../../config');

/**
 * POST {IAS_URL}{GET_MEMBER_INFO_API} with { memberNrc, meplEffDate } — no auth header
 * (confirmed shape, see ulink-is-ai/src/services/iasService.js::postMemberInfoByPolicy).
 * Explicit AbortController timeout, same discipline as email-intake/imapClient.js and
 * claim-recognition/linkedDocuments.js — an external call must not be able to hang the job.
 *
 * Returns the parsed body as-is: { success: true, payload: {...} } or
 * { success: false, error: "..." } (verified against
 * docs/imp/day1/samples/no_member_exist_case.json — no `payload` key at all on failure).
 * Callers must branch on `success` before touching `payload`.
 */
async function getMemberInfo({ memberNrc, meplEffDate }) {
  if (!config.ias.baseUrl || !config.ias.getMemberInfoApi) {
    throw new Error('IAS_URL and GET_MEMBER_INFO_API must be configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.ias.baseUrl}${config.ias.getMemberInfoApi}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ memberNrc, meplEffDate }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS member info request timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`IAS member info request failed with status ${response.status}`);
  }

  return response.json();
}

module.exports = { getMemberInfo };
