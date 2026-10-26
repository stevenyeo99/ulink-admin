const config = require('../../config');

// POST {IAS_URL}{path} with a JSON body — no auth header. Explicit AbortController timeout, same discipline as
// email-intake/imapClient.js and claim-recognition/linkedDocuments.js — an external call must not be able to hang the
// job. A network error, a timeout or a non-2xx answer throws (the job retries the case next run). Returns the parsed
// body as-is: callers must branch on `success` before touching `payload`.
async function postIas(path, body, what) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ias.timeoutMs);

  // The timeout covers the body too: a large answer (the balance is ~2,000 lines) can stall after its headers.
  try {
    const response = await fetch(`${config.ias.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`IAS ${what} request failed with status ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IAS ${what} request timed out after ${config.ias.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST {IAS_URL}{GET_MEMBER_INFO_API} with { memberNrc, meplEffDate }
 * (confirmed shape, see ulink-is-ai/src/services/iasService.js::postMemberInfoByPolicy).
 *
 * Returns { success: true, payload: {...} } or { success: false, error: "..." } (verified against
 * docs/imp/day1/samples/no_member_exist_case.json — no `payload` key at all on failure).
 */
async function getMemberInfo({ memberNrc, meplEffDate }) {
  if (!config.ias.baseUrl || !config.ias.getMemberInfoApi) {
    throw new Error('IAS_URL and GET_MEMBER_INFO_API must be configured');
  }
  return postIas(config.ias.getMemberInfoApi, { memberNrc, meplEffDate }, 'member info');
}

/**
 * POST {IAS_URL}{GET_MEMBER_LIMIT_BALANCE_API} with { memberRefNo, policyRefNo, policyEffDate } — the member's
 * remaining balance per limit (docs/imp/CR/SYSTEM_5/INTEGRATION/IAS_MEMBER_BALANCE_SPEC.md). The three values come
 * from the member info answer: member.MBR_REF_NO, policies[0].POCY_REF_NO, policies[0].EFF_DATE (MMDDYYYY).
 *
 * Returns { success: true, payload: { results: [{ plan_id, rev_no, pocy_plan_desc, limits: [...] }] } }.
 */
async function getMemberLimitBalance({ memberRefNo, policyRefNo, policyEffDate }) {
  if (!config.ias.baseUrl || !config.ias.getMemberLimitBalanceApi) {
    throw new Error('IAS_URL and GET_MEMBER_LIMIT_BALANCE_API must be configured');
  }
  return postIas(config.ias.getMemberLimitBalanceApi, { memberRefNo, policyRefNo, policyEffDate }, 'member limit balance');
}

module.exports = { getMemberInfo, getMemberLimitBalance };
