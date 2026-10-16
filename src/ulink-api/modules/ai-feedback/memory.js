// Correction memory (SYSTEM_4 E4-15 step 4, F3): before the AI maps a claim's pages into fields, it is given up to
// MAX_NOTES trusted reviewer corrections from past claims of the same hospital / clinic — as lessons, never as values.
//
// Rules (owner, 2026-10-16):
//   - only trusted value corrections where the page was misread or mapped wrong (not check verdicts);
//   - never personal fields (name, NRC, birth date, policy, bank): they belong to one customer and teach nothing;
//   - no past value reaches the prompt: only the field, the kind of mistake and the reviewer's reason with every
//     number / date replaced by "…", so the AI cannot copy another claim's amount or date;
//   - same provider = a name the past case's hospital had (as read or as corrected) appears in this claim's pages.
// Switch: usePastCorrections (STP settings). The case keeps which notes the AI saw (extractedFields.learnedFrom).

const { Op } = require('sequelize');
const { Case, ApiCaseStep, AiFeedback, sequelize } = require('../../db/models');
const { apiCaseView } = require('../api-pipeline/caseView');
const { lastReadSettings } = require('../settings/settings');
const { FIELD_LABELS } = require('../document-checking/checklist');
const { WRONG_STEP_LABELS } = require('./corrections');
const { currentCaseId } = require('../llm-calls/log');
const logger = require('../../utils/logger');

const MAX_NOTES = 5;
// ponytail: newest 500 trusted corrections scanned per claim; a provider column / index when there are thousands.
const CANDIDATES = 500;
const HOSPITAL = 'medical.hospital_or_clinic_name';
const PATTERN_FIELDS = new Set([
  'claim.appointment_date', 'claim.accident_date', 'claim.total_claim_amount', HOSPITAL,
  'medical.detail_of_illness_injury', 'medical.full_description_of_treatment', 'medical_record.date',
]);
const VOUCHER_ITEM = /^invoices\.items\.\d+\.(subtotal|date)$/;
const learnable = (item) => PATTERN_FIELDS.has(item) || VOUCHER_ITEM.test(item);

// Words only (letters with their marks — Myanmar script too — and digits), single-spaced, so a name matches whole words.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
// Every number, date, amount or code in the reviewer's reason → "…" (ASCII or Myanmar digits with their separators,
// and month names).
const MONTH = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/gi;
const withoutValues = (text) => String(text ?? '').replace(/[\d\u1040-\u1049][\d\u1040-\u1049,./:-]*/g, '…').replace(MONTH, '…').replace(/\bMay\b/g, '…'); // "may" the verb stays

// Voucher items are named without their position ("Voucher amount"), the label of their kind.
const noteLabel = (f) => (VOUCHER_ITEM.test(f.item) ? (f.item.endsWith('date') ? 'Voucher date' : 'Voucher amount') : FIELD_LABELS[f.item] ?? f.label);
// A reason is cut at REASON_CHARS, so 5 notes stay a few hundred tokens and never push a claim over the context limit.
const REASON_CHARS = 200;
const short = (text) => (text.length > REASON_CHARS ? `${text.slice(0, REASON_CHARS - 1)}…` : text);
const noteLine = (f) => `- ${noteLabel(f)} — ${WRONG_STEP_LABELS[f.wrongStep] ?? 'corrected by a reviewer'}: ${short(withoutValues(f.reason))}`;

// The hospital names each past case had: as the case reads now (the corrected value) and as the AI first read it.
async function providerNames(caseIds, corrections) {
  const names = new Map(caseIds.map((id) => [id, new Set()]));
  const add = (id, name) => { if (norm(name).length >= 3) names.get(id)?.add(norm(name)); };

  const cases = await Case.findAll({ where: { id: caseIds }, attributes: ['id', 'source', 'extractedFields'] });
  const apiIds = cases.filter((c) => c.source === 'API').map((c) => c.id);
  const steps = apiIds.length
    ? await ApiCaseStep.findAll({
      where: { caseId: apiIds, job: 'api-claim-recognition', status: 'DONE' },
      // Only the hospital name out of each output — not its page transcripts.
      attributes: ['caseId', 'job', 'status', 'createdAt', [sequelize.literal(
        `jsonb_build_object('extractedFields', jsonb_build_object('medical', jsonb_build_object('hospital_or_clinic_name', output->'extractedFields'->'medical'->'hospital_or_clinic_name')))`
      ), 'output']],
    })
    : [];
  for (const c of cases) {
    const fields = c.source === 'API' ? apiCaseView(steps.filter((s) => s.caseId === c.id)).extractedFields : c.extractedFields;
    add(c.id, fields?.medical?.hospital_or_clinic_name);
  }
  for (const f of corrections) {
    if (f.item === HOSPITAL) { add(f.caseId, f.aiValue); add(f.caseId, f.correctedValue); }
  }
  return names;
}

/**
 * The notes for a claim whose pages are transcriptChunks. Returns { block, learnedFrom }: block = text to add to the
 * mapping call ('' when none or switched off); learnedFrom = [{ id, item, label }] of the corrections used.
 */
// The notes are extra help: when they can't be looked up, the claim is read without them (logged), never held back.
async function pastCorrectionNotes(transcriptChunks) {
  if (!lastReadSettings().usePastCorrections) return { block: '', learnedFrom: [] };
  try {
    return await lookUpNotes(transcriptChunks);
  } catch (error) {
    logger.warn('Past correction notes not looked up — the claim is read without them', { error: error.message });
    return { block: '', learnedFrom: [] };
  }
}

async function lookUpNotes(transcriptChunks) {
  const none = { block: '', learnedFrom: [] };
  // The claim's own corrections are not "past claims" (a re-read after a customer reply).
  const ownCase = currentCaseId();

  const rows = (await AiFeedback.findAll({
    where: {
      trusted: true, kind: 'value', wrongStep: ['reading', 'mapping'],
      [Op.or]: [{ item: [...PATTERN_FIELDS] }, { item: { [Op.like]: 'invoices.items.%' } }],
    },
    order: [['createdAt', 'DESC']],
    limit: CANDIDATES,
  })).filter((f) => learnable(f.item) && f.caseId !== ownCase);
  if (!rows.length) return none;

  const pages = ` ${norm(transcriptChunks.join('\n'))} `;
  const names = await providerNames([...new Set(rows.map((f) => f.caseId))], rows);
  const sameProvider = rows.filter((f) => [...(names.get(f.caseId) ?? [])].some((n) => pages.includes(` ${n} `)));

  const seen = new Set();
  const used = [];
  for (const f of sameProvider) {
    const line = noteLine(f);
    if (seen.has(line)) continue;
    seen.add(line);
    used.push({ f, line });
    if (used.length === MAX_NOTES) break;
  }
  if (!used.length) return none;

  return {
    block: [
      'Reviewer notes from past claims of this hospital / clinic (trusted). They describe mistakes made before when',
      'reading its documents. They contain no values: take every value only from the page transcripts above.',
      ...used.map((u) => u.line),
    ].join('\n'),
    learnedFrom: used.map(({ f }) => ({ id: f.id, item: f.item, label: noteLabel(f) })),
  };
}

module.exports = { pastCorrectionNotes, withoutValues, MAX_NOTES };
