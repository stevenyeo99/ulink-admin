const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');
const { uniqueBenefitCandidates } = require('../../modules/shared/iasBenefits');
const { voucherKey } = require('../../modules/ias-claim-preparation/preparationReview');
const { pickBasis, withChosenPicks } = require('../../modules/member-verification/memberBalance');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { requiredComment } = require('./casesController');
const { endClaim } = require('../../modules/case-claim/claim');
const { markFor, BEING_CHECKED } = require('../../modules/review-lane/marker');
const reviewLane = () => require('../../modules/review-lane/lane'); // at call time: the lane loads every job module
const logger = require('../../utils/logger');

// "Choose the benefit" (SYSTEM_5 member balance phase C, docs/imp/CR/SYSTEM_5/PRD/MEMBER_BALANCE_PRD.md 4.6): the member
// check stopped because the AI wasn't sure of a voucher's benefit head (switch holdUnsureBenefit, both flows). A person
// chooses it; the member check runs again with it and checks the balance. The choices are kept as picks with chosen:
// true — email: on the case's memberVerifyResult; API: a 'benefit-review' step — and claim preparation reuses them.
const STATUSES = { BENEFIT_REVIEW: 'RECOGNIZED', API_BENEFIT_REVIEW: 'API_RECOGNIZED' };
const BLOCK_NAME = 'benefit-review';

const bad = (res, message) => res.status(400).json({ error: { message, status: 400 } });

// What the member check last saw: its result, the IAS member answer and the fields it read (API: from the steps).
async function memberFields(caseRecord) {
  if (caseRecord.source !== 'API') return { ...caseRecord.toJSON(), steps: null };
  const steps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  return { ...caseRecord.toJSON(), ...apiCaseView(steps), steps };
}

/**
 * POST /api/cases/:id/benefit — { benefits: [{ voucher, benefitType, benefitHead }], comment, recheck? }. Super admin.
 * Only at BENEFIT_REVIEW / API_BENEFIT_REVIEW. Every voucher the AI was unsure of must be chosen; a type and head must be
 * on the member's own plan (a head may be left out only where the plan has none for that type). The case goes back to
 * the member check, which reuses these and checks the balance. recheck: true — saved with corrections (a misread voucher
 * amount, the review page's one save): the choices are kept, the case does not move; the corrections move it back to
 * the member check.
 */
async function chooseBenefit(req, res) {
  const comment = requiredComment(req, res, 'you chose these');
  if (comment === null) return undefined;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (caseRecord.reviewPendingAt) return res.status(409).json({ error: { message: BEING_CHECKED, status: 409 } });
  const status = caseRecord.currentStatus;
  if (!STATUSES[status]) return bad(res, 'This case is not waiting for a benefit choice.');

  const fields = await memberFields(caseRecord);
  const result = fields.memberVerifyResult;
  const info = fields.iasMemberInfoResponse;
  const items = fields.extractedFields?.invoices?.items || [];
  const plan = uniqueBenefitCandidates(info?.payload?.memberPlans);
  const unsure = result?.balance?.unsure || [];

  const sent = Array.isArray(req.body?.benefits) ? req.body.benefits : [];
  const picks = [];
  const by = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  for (const b of sent) {
    const i = b?.voucher;
    const name = `Voucher ${Number.isInteger(i) ? i + 1 : '?'}`;
    if (!Number.isInteger(i) || !items[i]) return bad(res, `${name}: no such voucher on this case.`);
    if (picks.some((p) => p.voucher === i)) return bad(res, `${name} is chosen twice.`);
    const type = typeof b.benefitType === 'string' ? b.benefitType.trim() : '';
    const head = typeof b.benefitHead === 'string' && b.benefitHead.trim() ? b.benefitHead.trim() : null;
    if (!plan.some((c) => c.type === type)) return bad(res, `${name}: choose a benefit type on the member's plan.`);
    if (head ? !plan.some((c) => c.type === type && c.head === head) : plan.some((c) => c.type === type && c.head)) {
      return bad(res, `${name}: choose a benefit head of ${type} on the member's plan.`);
    }
    const ai = (result?.balance?.picks || []).find((p) => p.voucher === i && !p.chosen) || null;
    picks.push({
      voucher: i, key: voucherKey(items[i]), basis: pickBasis(fields.extractedFields, info),
      benefitType: type, benefitHead: head, chosen: true, by, comment, at: new Date().toISOString(),
      aiPick: ai && { benefitType: ai.benefitType, benefitHead: ai.benefitHead, confidence: ai.confidence },
    });
  }
  const undecided = unsure.filter((i) => !picks.some((p) => p.voucher === i));
  if (undecided.length) return bad(res, `Choose the benefit of voucher ${undecided.map((i) => i + 1).join(', ')} — the AI was not sure of it.`);
  if (!picks.length) return bad(res, 'Choose the benefit of a voucher.');

  const recheck = req.body?.recheck === true;
  const next = recheck ? status : STATUSES[status];
  const what = picks.map((p) => `voucher ${p.voucher + 1} ${p.benefitType}/${p.benefitHead ?? '-'} (AI: ${p.aiPick?.benefitHead ? `${p.aiPick.benefitType}/${p.aiPick.benefitHead}` : 'not sure'})`).join('; ');
  const now = new Date();
  const moved = await sequelize.transaction(async (transaction) => {
    // Email: the choices go over the picks on the case; API: a step the member check reads over its last picks.
    // Saved with corrections (recheck): the corrections move and mark the case, not this choice.
    const update = caseRecord.source === 'API' ? { currentStatus: next, ...(recheck ? {} : markFor(caseRecord, by)) } : { currentStatus: next, memberVerifyResult: withChosenPicks(result, picks) };
    const [count] = await Case.update(update, { where: { id: caseRecord.id, currentStatus: status }, transaction });
    if (count !== 1) return false;
    if (caseRecord.source === 'API') {
      const earlier = fields.steps.filter((s) => s.job === BLOCK_NAME && s.status === 'DONE').at(-1)?.output?.picks || [];
      await ApiCaseStep.create({
        caseId: caseRecord.id, job: BLOCK_NAME, status: 'DONE', input: null,
        output: { picks: [...earlier.filter((p) => !picks.some((x) => x.voucher === p.voucher)), ...picks], by, comment }, startedAt: now, finishedAt: now,
      }, { transaction });
    }
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: status, newStatus: next, reasonCode: 'MANUAL_BENEFIT',
      message: `Chosen by ${by}: ${what}${recheck ? ' (saved with corrections: checked again first)' : ''} — comment: ${comment}`,
    }, { transaction });
    return true;
  });
  if (!moved) return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  if (recheck) return res.json({ caseId: caseRecord.id, currentStatus: status });
  await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
  if (caseRecord.source === 'API') reviewLane().triggerReviewLane(); // SYSTEM_5 review lane: processed at once
  logger.info('Benefit chosen by a person', { caseId: caseRecord.id, vouchers: picks.length, username: req.user.username });
  return res.json({ caseId: caseRecord.id, currentStatus: next });
}

module.exports = { chooseBenefit };
