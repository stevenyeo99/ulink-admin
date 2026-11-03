// claim-recognition/linkedDocuments.js: a linked file is stored with the type that matches it, so the console can
// show it inline, even when the storage answers application/octet-stream (AYA's Azure storage).
const { fetchLinkedDocument } = require('../modules/claim-recognition/linkedDocuments');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const answer = (type) => ({
  ok: true,
  headers: { get: (h) => (h === 'content-type' ? type : null) },
  arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
});
const options = { timeoutMs: 1000, maxBytes: 1000 };

it('takes the type from the link when the storage says octet-stream', async () => {
  global.fetch = jest.fn(async () => answer('application/octet-stream'));
  const fetched = await fetchLinkedDocument('https://store.example.com/claims/Claim-Form.pdf.pdf', options);
  expect(fetched).toMatchObject({ contentType: 'application/pdf', ext: '.pdf' });
});

it('keeps a real header type, and refuses a file of an unknown type', async () => {
  global.fetch = jest.fn(async () => answer('image/png; charset=binary'));
  expect(await fetchLinkedDocument('https://store.example.com/a', options)).toMatchObject({ contentType: 'image/png', ext: '.png' });

  global.fetch = jest.fn(async () => answer('application/octet-stream'));
  await expect(fetchLinkedDocument('https://store.example.com/a.zip', options)).rejects.toThrow('unsupported content-type');
});
