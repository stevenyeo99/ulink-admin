// 2026-10-01 (case 42214c2a): the ICD-10 search uses the illness text alone — drug names in the
// treatment text drowned the symptoms and the pick fell back to R69. The AI pick still sees both.
jest.mock('../modules/icd10/lookup', () => ({
  findCandidates: jest.fn().mockResolvedValue([{ diagCode: 'R42', diagDesc: 'Dizziness and giddiness', similarity: 0.67 }]),
}));
jest.mock('../modules/claim-recognition/llmClient', () => ({
  synthesizeJson: jest.fn().mockResolvedValue({ diagCode: 'R42', diagDesc: 'Dizziness and giddiness', confidence: 0.8, reason: 'dizziness' }),
}));

const { findCandidates } = require('../modules/icd10/lookup');
const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { pickDiagnosis } = require('../modules/ias-claim-preparation/diagnosisPicker');

const fullText = 'Diagnosis/illness: Coughing dizziness\nTreatment: Im b12 Ampoxin Para Ketotifenpresco';

beforeEach(() => jest.clearAllMocks());

describe('pickDiagnosis search text', () => {
  it('searches the illness text alone; the pick still sees the treatment', async () => {
    const result = await pickDiagnosis(fullText, { searchText: 'Coughing dizziness' });
    expect(findCandidates).toHaveBeenCalledWith('Coughing dizziness', { topK: 5 });
    expect(synthesizeJson.mock.calls[0][0].userText).toContain('Im b12 Ampoxin');
    expect(result).toMatchObject({ pick: { diagCode: 'R42' }, defaulted: false });
  });

  it('no illness text: searches the full text, as before', async () => {
    await pickDiagnosis(fullText, { searchText: null });
    await pickDiagnosis(fullText);
    expect(findCandidates.mock.calls.map(([text]) => text)).toEqual([fullText, fullText]);
  });
});
