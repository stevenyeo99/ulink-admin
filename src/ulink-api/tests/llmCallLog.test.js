// SYSTEM_4 E4-26: every AI call is recorded in ulink_llm_calls — case and job (set where the job starts on a case),
// prompt name and version (from the prompt text), model, status, time, tokens, the answer and its confidence.
// Failures, timeouts and size refusals too; a failed log write never breaks the call. No real AI: fetch is replaced.

jest.mock('../db/models', () => ({ LlmCall: { create: jest.fn(async () => ({})) } }));

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { LlmCall } = require('../db/models');
const { synthesizeJson, transcribePage, DocumentsTooLongError } = require('../modules/claim-recognition/llmClient');
const { forCase, promptOf } = require('../modules/llm-calls/log');

const DIAGNOSIS_PROMPT = fs.readFileSync(path.join(__dirname, '../modules/ias-claim-preparation/prompts/diagnosis-pick.md'), 'utf8');
const answer = (content, usage = { prompt_tokens: 812, completion_tokens: 40 }) => jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ model: 'qwen-test', usage, choices: [{ message: { content } }] }) }));
const logged = async () => { await new Promise((r) => setImmediate(r)); return LlmCall.create.mock.calls.map(([row]) => row); };

const realFetch = global.fetch;
beforeAll(() => { config.llm.baseUrl = config.llm.baseUrl || 'http://llm.test'; });
beforeEach(() => jest.clearAllMocks());
afterAll(() => { global.fetch = realFetch; });

it('names a prompt by its file, with a version that changes when the text changes', () => {
  expect(promptOf(DIAGNOSIS_PROMPT)).toEqual({ promptName: 'diagnosis-pick', promptVersion: expect.stringMatching(/^[0-9a-f]{12}$/) });
  expect(promptOf(`${DIAGNOSIS_PROMPT} `).promptName).toBe('unknown');
  expect(promptOf(`${DIAGNOSIS_PROMPT} `).promptVersion).not.toBe(promptOf(DIAGNOSIS_PROMPT).promptVersion);
});

it('records a text call against the case and job that made it, with tokens, the answer and its confidence', async () => {
  global.fetch = answer('{"diagCode":"J06.9","confidence":0.82}');
  await forCase('case-1', 'ias-claim-preparation', () => synthesizeJson({ systemPrompt: DIAGNOSIS_PROMPT, userText: 'fever, cough', jsonSchema: { type: 'object' } }));
  expect(await logged()).toEqual([expect.objectContaining({
    caseId: 'case-1',
    job: 'ias-claim-preparation',
    callType: 'text',
    promptName: 'diagnosis-pick',
    model: 'qwen-test',
    status: 'ok',
    promptTokens: 812,
    completionTokens: 40,
    output: '{"diagCode":"J06.9","confidence":0.82}',
    confidence: 0.82,
    error: null,
  })]);
  expect((await logged())[0].estimatedTokens).toBeGreaterThan(0);
});

it('records a page reading as a vision call; a call outside any case has no case', async () => {
  const instruction = fs.readFileSync(path.join(__dirname, '../modules/claim-recognition/prompts/transcribe-page.md'), 'utf8');
  global.fetch = answer('Claim form: …', null); // LM Studio sent no token counts
  await transcribePage({ imageBuffer: Buffer.from('jpg'), instruction });
  expect(await logged()).toEqual([expect.objectContaining({ caseId: null, job: null, callType: 'vision', promptName: 'transcribe-page', status: 'ok', confidence: null, promptTokens: null })]);
});

it('records failures and timeouts, and the call still fails as before', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, statusText: 'Busy', text: async () => 'model loading' }));
  await expect(synthesizeJson({ systemPrompt: DIAGNOSIS_PROMPT, userText: 'x', jsonSchema: {} })).rejects.toThrow('LLM request failed (503');
  global.fetch = jest.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  await expect(synthesizeJson({ systemPrompt: DIAGNOSIS_PROMPT, userText: 'x', jsonSchema: {} })).rejects.toThrow('timed out');
  expect((await logged()).map((r) => [r.status, r.error])).toEqual([['error', 'HTTP 503: model loading'], ['timeout', expect.stringContaining('timed out after')]]);
});

it('records a call refused as too long — nothing sent', async () => {
  global.fetch = jest.fn();
  const huge = 'x'.repeat(config.llm.contextTokens * 4);
  await expect(forCase('case-2', 'claim-recognition', () => synthesizeJson({ systemPrompt: DIAGNOSIS_PROMPT, userText: huge, jsonSchema: {} }))).rejects.toBeInstanceOf(DocumentsTooLongError);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await logged()).toEqual([expect.objectContaining({ caseId: 'case-2', status: 'too_long', promptName: 'diagnosis-pick' })]);
});

it('never breaks the call when the log write fails', async () => {
  LlmCall.create.mockRejectedValueOnce(new Error('db down'));
  global.fetch = answer('{"ok":true}');
  await expect(synthesizeJson({ systemPrompt: DIAGNOSIS_PROMPT, userText: 'x', jsonSchema: {} })).resolves.toEqual({ ok: true });
});
