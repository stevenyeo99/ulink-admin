const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');
const { findCandidates, findByCode } = require('../../modules/icd10/lookup');
const { uniqueBenefitCandidates } = require('../../modules/shared/iasBenefits');
const { voucherKey, sameVoucher } = require('../../modules/ias-claim-preparation/preparationReview');
const { requiredComment } = require('./casesController');
const { endClaim } = require('../../modules/case-claim/claim');
const logger = require('../../utils/logger');

// A person decides what the AI wasn't sure of in claim preparation (owner, 2026-10-20): an API case stops at
// API_PREPARATION_REVIEW (switches holdUnsureDiagnosis / holdUnsureBenefit, api-claim-preparation) — the diagnosis
// code, a voucher's benefit, or both. The choices are a 'preparation-review' step; claim preparation runs again with
// them and never asks the AI for those again. Nothing goes to IAS from here.
const STATUS = 'API_PREPARATION_REVIEW';
const NEXT = 'API_READY_FOR_CLAIM_PREPARATION';
const BLOCK_NAME = 'preparation-review';

const latestDone = (steps, job) => steps.filter((s) => s.job === job && s.status === 'DONE').at(-1)?.output || null;
const bad = (res, message) => res.status(400).json({ error: { message, status: 400 } });

/**
 * POST /api/cases/:id/preparation — { diagCode?, benefits?: [{ voucher, benefitType, benefitHead }], comment }. Super
 * admin. Only at API_PREPARATION_REVIEW. Everything the stop asked for must be decided: the diagnosis when it was
 * unsure, every flagged voucher. A code must be in the ICD-10 table; a benefit type + head must be on the member's own
 * plan. All or nothing. Earlier choices on vouchers not sent stay. The AI's own picks are kept beside the person's.
 */
async function choosePreparation(req, res) {
  const comment = requiredComment(req, res, 'you chose these');
  if (comment === null) return undefined;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (caseRecord.source !== 'API' || caseRecord.currentStatus !== STATUS) return bad(res, 'This case is not waiting for the claim preparation check.');

  const steps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const meta = latestDone(steps, 'api-claim-preparation')?.claimPrepMeta;
  const items = latestDone(steps, 'api-claim-recognition')?.extractedFields?.invoices?.items || [];
  const plan = uniqueBenefitCandidates(latestDone(steps, 'api-member-verification')?.iasMemberInfoResponse?.payload?.memberPlans);
  const previous = latestDone(steps, BLOCK_NAME);
  if (!meta) return bad(res, 'The claim has not been prepared yet.');
  const review = meta.review || { diagnosis: false, vouchers: [] };

  // Diagnosis: a code from the table; required when the stop asked for it. The AI's pick: before any person's.
  const { diagCode } = req.body || {};
  let diagnosis = null;
  if (typeof diagCode === 'string' && diagCode.trim()) {
    const code = await findByCode(diagCode.trim());
    if (!code) return bad(res, 'Diagnosis: choose an ICD-10 code from the list or the search.');
    const { text = null, translation, chosen, review: _review, ...ai } = meta.diagnosis || {};
    diagnosis = { ...code, text, aiPick: chosen && previous?.diagnosis ? previous.diagnosis.aiPick : ai };
  } else if (review.diagnosis) {
    return bad(res, 'Diagnosis: choose the code — the AI was not sure of it.');
  } else if (previous?.diagnosis?.text === meta.diagnosis?.text) {
    diagnosis = previous.diagnosis;
  }

  // Benefits: a voucher of this case, a type + head on the member's own plan; every flagged voucher decided.
  const sent = Array.isArray(req.body?.benefits) ? req.body.benefits : [];
  const benefits = [];
  for (const b of sent) {
    const i = Number.isInteger(b?.voucher) ? b.voucher : -1;
    const name = `Voucher ${i + 1}`;
    if (!items[i]) return bad(res, 'Benefit: choose for a voucher of this claim.');
    if (benefits.some((x) => x.voucher === i)) return bad(res, `${name}: chosen twice.`);
    const head = b.benefitHead || null;
    if (!plan.some((c) => c.type === b.benefitType && (c.head || null) === head)) {
      return bad(res, `${name}: ${b.benefitType || '(no type)'} / ${head || '(no head)'} is not on the member's plan.`);
    }
    const line = meta.lines?.[i] || {};
    const earlier = (previous?.benefits || []).find((x) => x.voucher === i);
    const { chosen, ...ai } = line;
    benefits.push({ voucher: i, key: voucherKey(items[i]), benefitType: b.benefitType, benefitHead: head, aiPick: chosen && earlier ? earlier.aiPick : ai });
  }
  const missing = review.vouchers.filter((i) => !benefits.some((b) => b.voucher === i));
  if (missing.length) return bad(res, `Benefit: choose for voucher ${missing.map((i) => i + 1).join(', ')} — the AI was not sure.`);
  // Earlier choices on vouchers not sent this time stay, while their voucher is the same.
  for (const b of previous?.benefits || []) {
    if (!benefits.some((x) => x.voucher === b.voucher) && items[b.voucher] && sameVoucher(b.key, voucherKey(items[b.voucher]))) benefits.push(b);
  }
  if (!diagnosis && !benefits.length) return bad(res, 'Choose the diagnosis code or a benefit.');

  const by = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  const what = [
    diagnosis && diagnosis !== previous?.diagnosis && `diagnosis ${diagnosis.diagCode} (AI: ${diagnosis.aiPick?.pick?.diagCode ?? 'none'})`,
    ...benefits.filter((b) => sent.some((s) => s.voucher === b.voucher))
      .map((b) => `voucher ${b.voucher + 1} ${b.benefitType}/${b.benefitHead ?? '-'} (AI: ${b.aiPick?.pick ? `${b.aiPick.pick.benefitType}/${b.aiPick.pick.benefitHead ?? '-'}` : 'none'})`),
  ].filter(Boolean).join('; ');
  const now = new Date();
  const moved = await sequelize.transaction(async (transaction) => {
    const [count] = await Case.update({ currentStatus: NEXT }, { where: { id: caseRecord.id, currentStatus: STATUS }, transaction });
    if (count !== 1) return false;
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: BLOCK_NAME, status: 'DONE', input: null,
      output: { diagnosis, benefits, by, comment }, startedAt: now, finishedAt: now,
    }, { transaction });
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: STATUS, newStatus: NEXT, reasonCode: 'MANUAL_PREPARATION',
      message: `Chosen by ${by}: ${what || 'earlier choices kept'} — comment: ${comment}`,
    }, { transaction });
    return true;
  });
  if (!moved) return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
  logger.info('Claim preparation decided by a person', { caseId: caseRecord.id, diagnosis: diagnosis?.diagCode ?? null, vouchers: sent.length, username: req.user.username });
  return res.json({ caseId: caseRecord.id, currentStatus: NEXT });
}

/** GET /api/cases/:id/diagnosis-candidates?text= — ICD-10 codes nearest to the text (an exact scan: several seconds). */
async function searchDiagnosis(req, res) {
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  if (text.length < 3) return bad(res, 'Type at least 3 characters.');
  try {
    return res.json({ candidates: await findCandidates(text, { topK: 10 }) });
  } catch (error) {
    logger.error('diagnosis search failed', { caseId: req.params.id, error: error.message });
    return res.status(502).json({ error: { message: 'The ICD-10 search is not available right now. Pick from the AI candidates, or try again.', status: 502 } });
  }
}

module.exports = { choosePreparation, searchDiagnosis };
