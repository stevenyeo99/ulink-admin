// SYSTEM_4 E4-27: a text call that wouldn't fit the model's context (LM Studio: 30,976 tokens, 6,000 kept for the
// answer) is refused before anything is sent — LM Studio would otherwise cut the text and the AI would answer from
// part of the documents. No LLM is called here: fetch is replaced and must never be reached.

const config = require('../config');
const { synthesizeJson, estimateTokens, DocumentsTooLongError } = require('../modules/claim-recognition/llmClient');

const realFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(() => { throw new Error('no LLM calls in this test'); }); });
afterAll(() => { global.fetch = realFetch; });

it('estimates English at about 3.5 characters a token, and Burmese at a token per character', () => {
  expect(estimateTokens('a'.repeat(35))).toBe(10);
  expect(estimateTokens('ကျန်းမာ')).toBe(7);
  expect(estimateTokens(null)).toBe(0);
});

it('reads the limit from config: context minus the answer reserve', () => {
  expect(config.llm.contextTokens).toBeGreaterThan(config.llm.outputReserveTokens);
});

it('refuses a call that would not fit, before sending anything', async () => {
  const limit = config.llm.contextTokens - config.llm.outputReserveTokens;
  const call = synthesizeJson({ systemPrompt: 'Map the fields.', userText: 'x'.repeat(Math.ceil((limit + 100) * 3.5)), jsonSchema: { type: 'object' }, label: 'extract-fields' });
  await expect(call).rejects.toBeInstanceOf(DocumentsTooLongError);
  await expect(call).rejects.toThrow(/^Documents too long for the AI: about [\d,]+ tokens, limit [\d,]+\. A person reads them\.$/);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('counts Burmese text far more heavily than the same length of English', async () => {
  const limit = config.llm.contextTokens - config.llm.outputReserveTokens;
  const burmese = 'က'.repeat(limit + 1); // fits as English characters (≈ limit / 3.5 tokens), not as Burmese
  await expect(synthesizeJson({ systemPrompt: '', userText: burmese, jsonSchema: {} })).rejects.toBeInstanceOf(DocumentsTooLongError);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('lets a normal-sized claim through to the model', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }));
  config.llm.baseUrl = config.llm.baseUrl || 'http://llm.test';
  await expect(synthesizeJson({ systemPrompt: 'Map the fields.', userText: 'Page 1: claim form', jsonSchema: { type: 'object' } })).resolves.toEqual({ ok: true });
  expect(global.fetch).toHaveBeenCalledTimes(1); // the stand-in above, not the real server
});
