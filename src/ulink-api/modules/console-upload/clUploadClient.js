const config = require('../../config');

// POST cl-upload (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console-upload-spec.md): multipart
// TpaCaseNumber + file, header x-api-key. Answers { status: 'success', path } — no barcode; the
// console creates it later (console-barcode job).
//
// Two kinds of failure, handled differently by the caller:
// - thrown Error: technical (network, timeout, 5xx) — retried next run;
// - UploadRejected: the API said no (4xx, or status ≠ success) — a person has to look.
class UploadRejected extends Error {}

async function uploadToConsole({ tpaCaseNumber, pdf, filename }) {
  if (!config.clUpload.url || !config.clUpload.apiKey) throw new Error('CL_UPLOAD_URL and CL_UPLOAD_API_KEY must be configured');

  const form = new FormData();
  form.append('TpaCaseNumber', tpaCaseNumber);
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.clUpload.timeoutMs);
  let response;
  try {
    response = await fetch(config.clUpload.url, { method: 'POST', headers: { 'x-api-key': config.clUpload.apiKey }, body: form, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`cl-upload timed out after ${config.clUpload.timeoutMs}ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => null);
  if (response.status >= 500) throw new Error(`cl-upload failed with status ${response.status}`);
  if (!response.ok || body?.status !== 'success') {
    throw new UploadRejected(`cl-upload refused the upload (status ${response.status})${body ? `: ${JSON.stringify(body).slice(0, 300)}` : ''}`);
  }
  return { path: body.path ?? null };
}

module.exports = { uploadToConsole, UploadRejected };
