const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const { synthesizeJson } = require('./llmClient');
const { labVouchersOffDate, parseFollowUp } = require('../document-checking/labFollowUp');

// The doctor's note and follow-up period, read only when the date check can use them (users, 2026-11-10; the rule is
// document-checking/labFollowUp.js): a lab / imaging voucher is dated differently from the medical record. One extra
// text-only call over the page transcripts already made, so the main extraction (its prompt, its schema, every other
// case) is untouched. The AI reads; code compares the dates.
//
//   input:  the extracted fields, the page transcripts
//   output: the fields, with medical_record.doctor_note / follow_up / follow_up_evidence { confidence, reason, page,
//           recordDate: the visit it was read for }
//           and, on each such voucher, doctor_fee { found, confidence } — or unchanged when the rule does not apply
//           or the call fails (the date check then fails as before, and a person decides).

const PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'doctor-follow-up.md'), 'utf8');
const NOTE_MAX = 300;

const SCORE = { type: ['number', 'null'] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // The reason before the period: the model writes what it saw before it commits to a value (see buildRouteSchema).
  required: ['doctor_note', 'follow_up_reason', 'follow_up', 'follow_up_confidence', 'follow_up_page', 'vouchers'],
  properties: {
    doctor_note: { type: ['string', 'null'] },
    follow_up_reason: { type: ['string', 'null'] },
    follow_up: { type: ['string', 'null'] },
    follow_up_confidence: SCORE,
    follow_up_page: { type: ['string', 'null'] },
    vouchers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['voucher', 'has_consultation_or_doctor_fee', 'confidence'],
        properties: { voucher: { type: 'integer' }, has_consultation_or_doctor_fee: { type: ['boolean', 'null'] }, confidence: SCORE },
      },
    },
  },
};

// A score outside 0–1 is "not recorded", never a guess (the same rule as claim-recognition's dropOutOfRangeEvidence).
const score = (n) => (typeof n === 'number' && n >= 0 && n <= 1 ? n : null);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

async function readDoctorFollowUp(fields, transcriptChunks, ask = synthesizeJson) {
  const indexes = labVouchersOffDate(fields);
  if (!indexes.length) return fields;
  const items = fields.invoices.items;
  const userText = [
    `Medical record date: ${fields.medical_record.date}`,
    'Lab / imaging vouchers to look at:',
    ...indexes.map((i) => `- Voucher ${i + 1}: dated ${items[i].date}, amount ${items[i].subtotal ?? 'not read'}${items[i].evidence?.page ? `, on ${items[i].evidence.page}` : ''}`),
    '',
    'Page transcripts:',
    transcriptChunks.join('\n\n'),
  ].join('\n');

  let answer;
  try {
    // ponytail: the whole claim's transcripts again; send only the medical record and voucher pages if these calls get slow.
    // maxTokens: a short answer — a model caught in a loop is cut off (as for extract-fields), not left to run for minutes.
    answer = await ask({ systemPrompt: PROMPT, userText, jsonSchema: SCHEMA, label: 'doctor-follow-up', maxTokens: config.llm.outputReserveTokens });
  } catch (error) {
    logger.warn('Doctor follow-up not read; the date check decides without it', { error: error.message });
    return fields;
  }
  if (!answer || typeof answer !== 'object') return fields;

  // Only the fixed form is kept ("2 weeks"); anything else is no period, and the reason says what was read.
  const period = parseFollowUp(answer.follow_up);
  const raw = text(answer.follow_up);
  const reason = [text(answer.follow_up_reason), raw && !period ? `not a period: "${raw}"` : null].filter(Boolean).join('; ') || null;
  const fees = new Map((Array.isArray(answer.vouchers) ? answer.vouchers : []).map((v) => [v?.voucher, v]));

  return {
    ...fields,
    medical_record: {
      ...fields.medical_record,
      doctor_note: text(answer.doctor_note)?.slice(0, NOTE_MAX) ?? null,
      follow_up: period?.text ?? null,
      follow_up_evidence: {
        confidence: period ? score(answer.follow_up_confidence) : null, reason, page: period ? text(answer.follow_up_page) : null,
        recordDate: fields.medical_record.date,
      },
    },
    invoices: {
      ...fields.invoices,
      items: items.map((item, i) => {
        if (!indexes.includes(i)) return item;
        const fee = fees.get(i + 1);
        const found = typeof fee?.has_consultation_or_doctor_fee === 'boolean' ? fee.has_consultation_or_doctor_fee : null;
        return { ...item, doctor_fee: { found, confidence: found === null ? null : score(fee.confidence) } };
      }),
    },
  };
}

module.exports = { readDoctorFollowUp };
