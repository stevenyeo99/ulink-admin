const config = require('../../config');

// ulink-console-middleware (see its docs/samples/API.md). The zip call fetches every image from
// the graph service one by one (about 0.5 s each, up to 100), so it gets far longer than the
// 30 s IAS timeout.
const TIMEOUT_MS = 120000;

async function call(path, init = {}) {
  if (!config.apiMaterialDownload.middlewareUrl) {
    throw new Error('CONSOLE_MIDDLEWARE_URL must be configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${config.apiMaterialDownload.middlewareUrl}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Middleware request to ${path} timed out after ${TIMEOUT_MS}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`Middleware ${path} failed with status ${response.status}${body && body.error ? `: ${body.error}` : ''}`);
  }
  return response;
}

// One page of GET /api/files/materials — { items: [{ barcodeId, scanId, createdAt, materials }], hasMore }.
async function listMaterials(scanId, skip) {
  const query = new URLSearchParams({ scanId, skip: String(skip), limit: '50' });
  const response = await call(`/api/files/materials?${query}`, { headers: { Accept: 'application/json' } });
  return response.json();
}

// POST /api/files/download/zip — the zip's bytes, laid out as <scanId>/<barcodeId>/<file>.
async function downloadZip(scanId, items) {
  const response = await call('/api/files/download/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanId, items }),
  });
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { listMaterials, downloadZip };
