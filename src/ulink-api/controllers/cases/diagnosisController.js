const { sequelize, Case, CaseEvent, ApiCaseStep } = require('../../db/models');
const { findCandidates, findByCode } = require('../../modules/icd10/lookup');
const { requiredComment } = require('./casesController');
const { endClaim } = require('../../modules/case-claim/claim');
const logger = require('../../utils/logger');

// A person chooses the ICD-10 diagnosis code (owner, 2026-10-20): an API case whose code the AI wasn't sure of stops at
// API_DIAGNOSIS_REVIEW (switch holdUnsureDiagnosis, api-claim-preparation). The choice is a 'diagnosis-review' step;
// claim preparation runs again with it and never asks the AI for the code again. Nothing goes to IAS from here.
const STATUS = 'API_DIAGNOSIS_REVIEW';
const BLOCK_NAME = 'diagnosis-review';

/**
 * POST /api/cases/:id/diagnosis — { diagCode, comment }. Super admin. Only at API_DIAGNOSIS_REVIEW, only a code in the
 * ICD-10 table. The AI's own pick is kept on the step, next to the person's.
 */
async function chooseDiagnosis(req, res) {
  const comment = requiredComment(req, res, 'you chose this diagnosis code');
  if (comment === null) return undefined;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (caseRecord.source !== 'API' || caseRecord.currentStatus !== STATUS) {
    return res.status(400).json({ error: { message: 'This case is not waiting for a diagnosis code.', status: 400 } });
  }
  const code = typeof req.body?.diagCode === 'string' ? await findByCode(req.body.diagCode.trim()) : null;
  if (!code) return res.status(400).json({ error: { message: 'Choose an ICD-10 code from the list or the search.', status: 400 } });

  const prepared = await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'api-claim-preparation', status: 'DONE' }, order: [['createdAt', 'DESC']] });
  // text: what the AI searched with — the choice holds only while the diagnosis text stays the same (checkCase).
  const { text = null, translation, chosen, ...aiPick } = prepared?.output?.claimPrepMeta?.diagnosis || {};
  const by = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  const now = new Date();
  const moved = await sequelize.transaction(async (transaction) => {
    const [count] = await Case.update({ currentStatus: 'API_READY_FOR_CLAIM_PREPARATION' }, { where: { id: caseRecord.id, currentStatus: STATUS }, transaction });
    if (count !== 1) return false;
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: BLOCK_NAME, status: 'DONE', input: null,
      output: { ...code, text, aiPick, by, comment }, startedAt: now, finishedAt: now,
    }, { transaction });
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: STATUS, newStatus: 'API_READY_FOR_CLAIM_PREPARATION', reasonCode: 'MANUAL_DIAGNOSIS',
      message: `Diagnosis code ${code.diagCode} chosen by ${by} (AI: ${aiPick.pick?.diagCode ?? 'none'}) — comment: ${comment}`,
    }, { transaction });
    return true;
  });
  if (!moved) return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
  logger.info('Diagnosis code chosen', { caseId: caseRecord.id, diagCode: code.diagCode, username: req.user.username });
  return res.json({ caseId: caseRecord.id, currentStatus: 'API_READY_FOR_CLAIM_PREPARATION', diagnosis: code });
}

/** GET /api/cases/:id/diagnosis-candidates?text= — ICD-10 codes nearest to the text (an exact scan: several seconds). */
async function searchDiagnosis(req, res) {
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  if (text.length < 3) return res.status(400).json({ error: { message: 'Type at least 3 characters.', status: 400 } });
  try {
    return res.json({ candidates: await findCandidates(text, { topK: 10 }) });
  } catch (error) {
    logger.error('diagnosis search failed', { caseId: req.params.id, error: error.message });
    return res.status(502).json({ error: { message: 'The ICD-10 search is not available right now. Pick from the AI candidates, or try again.', status: 502 } });
  }
}

module.exports = { chooseDiagnosis, searchDiagnosis };
