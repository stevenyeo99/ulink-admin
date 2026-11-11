// The doctor's note's main diagnosis or symptom, for the ICD-10 search (UAT AYA-CL-26035164): an unsure or unreadable
// term gives no search (R69 stays).
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));
const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { mainDiagnosisTerm } = require('../modules/ias-claim-preparation/medicalTranslation');

it.each([
  [{ term: ' fever ', confidence: 0.9 }, 'fever'],
  [{ term: 'gastritis', confidence: 0.2 }, null],
  [{ term: 'unclear', confidence: 0.9 }, null],
  [{ term: null, confidence: 0 }, null],
])('%j → %p', async (answer, expected) => {
  synthesizeJson.mockResolvedValueOnce(answer);
  expect(await mainDiagnosisTerm('c/o fever x 1 day')).toBe(expected);
});
