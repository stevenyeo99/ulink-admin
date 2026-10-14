// SYSTEM_4 E4-27, email cases: a claim too long for the model's context is read by a person ("Needs manual reading",
// DOCUMENTS_TOO_LONG) — the size is checked before the call, so no LLM is called here.

jest.mock('../db/models', () => ({}));
jest.mock('../modules/claim-recognition/llmClient', () => {
  const actual = jest.requireActual('../modules/claim-recognition/llmClient');
  return { ...actual, transcribePage: jest.fn(), synthesizeJson: jest.fn() };
});

const { synthesizeJson, DocumentsTooLongError } = require('../modules/claim-recognition/llmClient');
const { recognizeFromTranscripts } = require('../modules/claim-recognition/service');

const routes = [{ routeKey: 'ayas_member_claim', label: 'AYA member claim', extractionSchema: { type: 'object' } }];

it('goes to manual review with the reason when the documents are too long', async () => {
  synthesizeJson.mockRejectedValue(new DocumentsTooLongError(40000, 24976));
  await expect(recognizeFromTranscripts(['[a.pdf - page 1]\n…'], '', routes)).resolves.toEqual({
    outcome: 'MANUAL_REVIEW',
    recognizedType: null,
    reasonCode: 'DOCUMENTS_TOO_LONG',
    message: 'Documents too long for the AI: about 40,000 tokens, limit 24,976. A person reads them.',
    extractedFields: null,
  });
});

it('still treats any other failure as technical (thrown, retried next run)', async () => {
  synthesizeJson.mockRejectedValue(new Error('LLM request timed out'));
  await expect(recognizeFromTranscripts(['x'], '', routes)).rejects.toThrow('LLM request timed out');
});
