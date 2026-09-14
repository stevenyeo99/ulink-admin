const fs = require('fs');
const path = require('path');
const { synthesizeJson } = require('../claim-recognition/llmClient');
const { uniqueBenefitCandidates } = require('../shared/iasBenefits');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'benefit-pick.md'), 'utf8');

const SCHEMA = {
  type: 'object',
  required: ['benefitType', 'benefitHead', 'confidence'],
  properties: {
    benefitType: { type: ['string', 'null'] },
    benefitHead: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
};

const CONFIDENCE_THRESHOLD = 0.5;

/**
 * LLM pick from the member's own plan's valid benefit combos — never a lookup against a
 * generic/global benefit-code table, since only pairs this specific plan covers are ever
 * valid to submit. Returns null (never a guess) if there are no candidates or confidence
 * is too low.
 *
 * Called once per invoice-item line (not once per case) — `voucherType` (from that specific
 * voucher's own extractedFields.invoices.items[].voucher_type) is the strongest signal when
 * present; the other fields are case-level fallback context for when it's null/"other".
 */
async function pickBenefit(
  { typeOfPatient, claimBenefitType, illnessDescription, treatmentDescription, voucherType },
  memberPlansRaw
) {
  const candidates = uniqueBenefitCandidates(memberPlansRaw);
  if (candidates.length === 0) return null;

  const userText = [
    `Voucher type (this specific line, strongest signal if not null/other): ${voucherType || 'null'}`,
    `Type of patient: ${typeOfPatient || 'unknown'}`,
    `Claim benefit type (as submitted): ${claimBenefitType || 'unknown'}`,
    `Illness/injury description: ${illnessDescription || '(none)'}`,
    `Treatment description: ${treatmentDescription || '(none)'}`,
    '',
    "Candidates valid for this member's own plan:",
    ...candidates.map((c) => `- type=${c.type} (${c.typeDesc}), head=${c.head || '(none)'} (${c.headDesc || '(none)'})`),
  ].join('\n');

  const result = await synthesizeJson({ systemPrompt: SYSTEM_PROMPT, userText, jsonSchema: SCHEMA });
  if (!result.benefitType || result.confidence < CONFIDENCE_THRESHOLD) return null;

  return { benefitType: result.benefitType, benefitHead: result.benefitHead };
}

module.exports = { pickBenefit };
