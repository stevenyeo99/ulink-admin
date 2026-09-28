// Burmese diagnosis / treatment → English before the ICD-10 search (ias-claim-preparation/medicalTranslation.js).
// The LLM call is mocked; English-only text must never call it.

jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));

const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { hasBurmese, toEnglishMedicalText } = require('../modules/ias-claim-preparation/medicalTranslation');

beforeEach(() => jest.clearAllMocks());

it('spots Myanmar script, including mixed Burmese + English text', () => {
  expect(hasBurmese('လည်ပင်း ultrasound စစ်ဆေးရန်')).toBe(true);
  expect(hasBurmese('check and follow up treatment')).toBe(false);
  expect(hasBurmese(null)).toBe(false);
});

it('passes English text through without calling the AI', async () => {
  const result = await toEnglishMedicalText({ diagnosis: 'Fever', treatment: 'Paracetamol' });
  expect(result).toEqual({ diagnosis: 'Fever', treatment: 'Paracetamol', translation: null });
  expect(synthesizeJson).not.toHaveBeenCalled();
});

it('translates Burmese and keeps the original for the audit trail', async () => {
  synthesizeJson.mockResolvedValue({ diagnosis_en: 'Neck lump, for ultrasound examination', treatment_en: null, confidence: 0.7, note: 'Second phrase unclear.' });

  const result = await toEnglishMedicalText({ diagnosis: 'လည်ပင်း ultrasound စစ်ဆေးရန်', treatment: null });

  expect(result).toEqual({
    diagnosis: 'Neck lump, for ultrasound examination',
    treatment: null,
    translation: { original: { diagnosis: 'လည်ပင်း ultrasound စစ်ဆေးရန်', treatment: null }, confidence: 0.7, note: 'Second phrase unclear.' },
  });
});

it('falls back to the original text if the AI returns no translation for a part', async () => {
  synthesizeJson.mockResolvedValue({ diagnosis_en: null, treatment_en: 'Observation', confidence: 0.4, note: null });
  const result = await toEnglishMedicalText({ diagnosis: 'အဆုတ်', treatment: 'စောင့်ကြည့်ခြင်း' });
  expect(result.diagnosis).toBe('အဆုတ်');
  expect(result.treatment).toBe('Observation');
});
