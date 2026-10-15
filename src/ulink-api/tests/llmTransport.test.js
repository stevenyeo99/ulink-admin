// The AI call's transport (claim-recognition/llmClient.js httpPost): node:http instead of fetch, because Node's fetch
// gives up after 300 s waiting for response headers — a long field-mapping call died at 5 min (2026-10-15 E3 check).
// Checked against a real local HTTP server: the request and JSON answer, an HTTP error, and the abort (LLM_TIMEOUT_MS).

const http = require('http');
const { transport } = require('../modules/claim-recognition/llmClient');

let server;
let url;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/slow') {
        const timer = setTimeout(() => res.end('{}'), 5000);
        return res.on('close', () => clearTimeout(timer)); // the client aborted: don't keep the server waiting
      }
      if (req.url === '/trickle') { // the headers come at once, the answer never finishes
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"choices": [');
        const timer = setTimeout(() => res.end(']}'), 5000);
        return res.on('close', () => clearTimeout(timer));
      }
      if (req.url === '/busy') { res.statusCode = 503; res.statusMessage = 'Busy'; return res.end('model loading'); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ echo: JSON.parse(body), type: req.headers['content-type'] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

it('posts JSON and reads the JSON answer, like fetch', async () => {
  const response = await transport.post(`${url}/v1/chat/completions`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hello: 'မင်္ဂလာပါ' }) });
  expect(response).toMatchObject({ ok: true, status: 200 });
  expect(await response.json()).toEqual({ echo: { hello: 'မင်္ဂလာပါ' }, type: 'application/json' });
});

it('an HTTP error is a response, not a throw', async () => {
  const response = await transport.post(`${url}/busy`, { body: '{}' });
  expect(response).toMatchObject({ ok: false, status: 503, statusText: 'Busy' });
  expect(await response.text()).toBe('model loading');
});

it('the abort (LLM_TIMEOUT_MS) still ends a call — as an AbortError', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await expect(transport.post(`${url}/slow`, { body: '{}', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

it('an abort while the answer is still arriving is an AbortError too (logged as a timeout, not an error)', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200); // after the headers, before the end of the answer
  await expect(transport.post(`${url}/trickle`, { body: '{}', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
