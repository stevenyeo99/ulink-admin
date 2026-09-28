const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');

// Burmese diagnosis / treatment text → clinical English, for the English-only parts of claim
// preparation: the ICD-10 search (English descriptions, English embedding model) and the diagnosis /
// benefit picks. Found on real data (AYA-CL-26034912): Burmese diagnosis text only retrieved generic
// codes, so the pick fell back to R69.
//
// Translated only here, where it's used — OCR keeps the original, which stays the source of truth
// and is what goes to IAS as the diagnosis description. English-only text is passed through with no
// LLM call.

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'translate-medical.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['diagnosis_en', 'treatment_en', 'confidence', 'note'],
  properties: {
    diagnosis_en: { type: ['string', 'null'] },
    treatment_en: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    note: { type: ['string', 'null'] },
  },
};

// Myanmar script (main block + Extended-A / Extended-B).
const MYANMAR_SCRIPT = /[က-႟ꩠ-ꩿꧠ-꧿]/;

function hasBurmese(text) {
  return typeof text === 'string' && MYANMAR_SCRIPT.test(text);
}

/**
 * { diagnosis, treatment } → { diagnosis, treatment, translation }.
 * diagnosis / treatment: the text to use downstream (English when translated, else unchanged).
 * translation: null when nothing needed translating; otherwise
 *   { original: { diagnosis, treatment }, confidence, note } for the audit trail and reviewers.
 */
async function toEnglishMedicalText({ diagnosis = null, treatment = null }) {
  if (!hasBurmese(diagnosis) && !hasBurmese(treatment)) return { diagnosis, treatment, translation: null };

  const userText = [`Diagnosis/illness: ${diagnosis || '(none)'}`, `Treatment: ${treatment || '(none)'}`].join('\n');
  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });

  return {
    diagnosis: diagnosis ? result.diagnosis_en || diagnosis : diagnosis,
    treatment: treatment ? result.treatment_en || treatment : treatment,
    translation: {
      original: { diagnosis, treatment },
      confidence: typeof result.confidence === 'number' ? result.confidence : null,
      note: result.note || null,
    },
  };
}

module.exports = { hasBurmese, toEnglishMedicalText };
