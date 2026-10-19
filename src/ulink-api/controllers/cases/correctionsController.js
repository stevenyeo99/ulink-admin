const { sequelize, Case, CaseEvent, ApiCaseStep, AiFeedback } = require('../../db/models');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { OVERRIDE_TARGETS } = require('../../modules/case-override/override');
const { correctionOptions, validateCorrection, aiOriginal, applyCorrection, correctionText, recheckFrom } = require('../../modules/ai-feedback/corrections');
const logger = require('../../utils/logger');

// Per-item correction (SYSTEM_4 E4-12, E4-15 step 1). Allowed where a whole-check override is (a member or document
// finding stopped the case), by the same people (super admin — a corrected bank account or amount reaches the claim).
// Saving checks the case again with the corrected fields — from the member check when the value is one it compares
// with IAS, else from the document check (corrections.js recheckFrom) — and the usual jobs run. No IAS write here
// (Q16: a correction changes our checks, decision and AI remark; the claim built later uses the corrected fields).
// While a member or document finding holds the case, and while it waits for the customer (owner, 2026-10-19: a value
// the AI read wrong is corrected before the claim goes — or goes again — to IAS; email INCOMPLETE is an override
// status already). After the correction the case is checked again: documents complete → claim preparation and (API)
// a new IAS revision that lifts the suspense; documents still missing → it waits for that person, who sends the
// request (correctionHold — a correction never emails the customer on its own).
const CORRECTABLE_STATUSES = [...new Set([...Object.keys(OVERRIDE_TARGETS), 'API_CLAIM_SUSPENDED', 'INCOMPLETE'])];
const RECOGNITION_JOB = 'api-claim-recognition';

// Member findings are marked OK only while the member check holds the case — after a whole-check override the case is
// past it, and a Mark OK there would send it back through the member check.
const heldByMember = (fields) => (/MEMBER_REVIEW_REQUIRED$/.test(fields.currentStatus || '') ? fields.memberVerifyResult : null);

const operatorOf = (user) => (user.name ? `${user.name} (${user.username})` : user.username);

// The case's fields as the jobs read them; API: from the latest recognition step (the one a correction replaces).
async function caseFields(caseRecord) {
  if (caseRecord.source !== 'API') return { fields: caseRecord.toJSON(), recognitionStep: null };
  const steps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const recognitionStep = steps.filter((s) => s.job === RECOGNITION_JOB && s.status === 'DONE').at(-1) || null;
  return { fields: { ...caseRecord.toJSON(), ...apiCaseView(steps) }, recognitionStep };
}

// For the case page: whether corrections are allowed now, what can be corrected, and the corrections so far — each
// with applied: still in force (false once the case was read again, e.g. after the customer sent new documents: a
// fresh reading replaces the fields; the learning record stays).
async function correctionsInfo(caseRecord, fields) {
  const rows = await AiFeedback.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const inForce = new Set((fields.extractedFields?.corrections || []).map((c) => c.id));
  const list = rows.map((row) => ({ ...(row.toJSON ? row.toJSON() : row), applied: inForce.has(row.id) }));
  const allowed = CORRECTABLE_STATUSES.includes(fields.currentStatus) && Boolean(fields.extractedFields);
  // options: what can be corrected (when allowed) or confirmed (whenever the AI has read the case — E5b "✓ Right").
  return { allowed, options: fields.extractedFields ? correctionOptions(fields.extractedFields, fields.documentCheckResult, heldByMember(fields)) : [], list };
}

/**
 * POST /api/cases/:id/corrections — { kind: value|verdict, item, value? | passed?, reason, wrongStep }.
 * Stores the correction, writes it into the case's fields, and sends the case back to the member check.
 */
async function createCorrection(req, res) {
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (!CORRECTABLE_STATUSES.includes(caseRecord.currentStatus)) {
    return res.status(400).json({ error: { message: 'Corrections are made while a member or document finding holds the case, or while it waits for the customer.', status: 400 } });
  }
  const { fields, recognitionStep } = await caseFields(caseRecord);
  if (!fields.extractedFields || (caseRecord.source === 'API' && !recognitionStep)) {
    return res.status(400).json({ error: { message: 'The AI has not read this case yet — nothing to correct.', status: 400 } });
  }

  const checked = validateCorrection(req.body, correctionOptions(fields.extractedFields, fields.documentCheckResult, heldByMember(fields)));
  if (checked.error) return res.status(400).json({ error: { message: checked.error, status: 400 } });
  const { option, corrected } = checked;
  const original = aiOriginal(fields.extractedFields, option, fields.documentCheckResult);
  const operator = operatorOf(req.user);
  const prevStatus = caseRecord.currentStatus;
  const recheck = recheckFrom(option.item, prevStatus);
  const newStatus = recheck[caseRecord.source === 'API' ? 'API' : 'EMAIL'];

  const feedback = await sequelize.transaction(async (transaction) => {
    const row = await AiFeedback.create({
      caseId: caseRecord.id, kind: option.kind, item: option.item, label: option.label,
      aiValue: original.aiValue, aiConfidence: original.aiConfidence, correctedValue: corrected,
      reason: req.body.reason.trim(), wrongStep: req.body.wrongStep, page: original.page, createdBy: req.user.username,
    }, { transaction });
    const correction = {
      id: row.id, kind: option.kind, item: option.item, label: option.label, aiValue: original.aiValue,
      aiConfidence: original.aiConfidence, corrected, reason: row.reason, wrongStep: row.wrongStep, page: original.page,
      by: operator, at: row.createdAt,
      // A member Mark OK covers exactly the finding the person saw (member-verification/checks.js).
      ...(option.item.startsWith('member:') ? { covers: option.note } : {}),
    };
    const extractedFields = applyCorrection(fields.extractedFields, correction);

    // Only if nothing moved the case meanwhile (same guard as override).
    const [count] = await Case.update(
      caseRecord.source === 'API' ? { currentStatus: newStatus } : { currentStatus: newStatus, extractedFields },
      { where: { id: caseRecord.id, currentStatus: prevStatus }, transaction }
    );
    if (count !== 1) throw Object.assign(new Error('moved'), { moved: true });
    if (caseRecord.source === 'API') {
      // A new recognition step with the corrected fields: every later API job reads the latest one; the AI's own
      // step stays as it was.
      const now = new Date();
      await ApiCaseStep.create({
        caseId: caseRecord.id, job: RECOGNITION_JOB, status: 'DONE',
        input: { correction: row.id, username: req.user.username },
        output: { ...recognitionStep.output, extractedFields },
        startedAt: now, finishedAt: now,
      }, { transaction });
    }
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus, reasonCode: 'MANUAL_CORRECTION',
      message: `${correctionText(correction)}. Checked again from ${recheck.label}.`,
    }, { transaction });
    return row;
  }).catch((error) => {
    if (error.moved) return null;
    throw error;
  });
  if (!feedback) {
    return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  }

  logger.info('Case item corrected', { caseId: caseRecord.id, item: option.item, kind: option.kind, username: req.user.username });
  res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: newStatus, correction: feedback });
}

/**
 * POST /api/cases/:id/confirmations — { kind: value|verdict, item, reason? }. "✓ Right" in the review workspace
 * (SYSTEM_4 E4-20, E5b): the reviewer checked a value or verdict against the document and the AI was right. Stored as
 * learning data (ulink_ai_feedback kind 'confirm': the value, the AI's confidence, the page, who) — it changes nothing
 * on the case: no status move, no case history. Once per person per item and value (a second click is the same answer).
 */
async function createConfirmation(req, res) {
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const { fields } = await caseFields(caseRecord);
  if (!fields.extractedFields) return res.status(400).json({ error: { message: 'The AI has not read this case yet — nothing to confirm.', status: 400 } });

  const option = correctionOptions(fields.extractedFields, fields.documentCheckResult, heldByMember(fields))
    .find((o) => o.kind === req.body?.kind && o.item === req.body?.item);
  if (!option || option.item.startsWith('member:')) return res.status(400).json({ error: { message: 'Pick a value or check of this case.', status: 400 } });
  if (option.current == null) return res.status(400).json({ error: { message: `${option.label}: the AI read nothing to confirm.`, status: 400 } });

  // A value a person corrected is no longer the AI's: confirming it would count a wrong AI read as right. Agreeing with
  // a correction is "Mark trusted".
  if ((fields.extractedFields.corrections || []).some((c) => c.item === option.item)) {
    return res.status(400).json({ error: { message: `${option.label} was corrected by a person — mark that correction trusted instead.`, status: 400 } });
  }
  const original = aiOriginal(fields.extractedFields, option, fields.documentCheckResult);
  const same = (row) => JSON.stringify(row.correctedValue) === JSON.stringify(option.current);
  const mine = await AiFeedback.findAll({ where: { caseId: caseRecord.id, kind: 'confirm', item: option.item, createdBy: req.user.username } });
  const existing = mine.find(same);
  if (existing) return res.json({ confirmation: existing });

  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Checked against the document';
  let row;
  try {
    row = await AiFeedback.create({
      caseId: caseRecord.id, kind: 'confirm', item: option.item, label: option.label,
      aiValue: option.current, aiConfidence: original.aiConfidence, correctedValue: option.current,
      reason, wrongStep: null, page: original.page, createdBy: req.user.username,
    });
  } catch (error) {
    // Two clicks at once: the unique index (ulink_ai_feedback_confirm_once) kept one — that one is the answer.
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;
    row = (await AiFeedback.findAll({ where: { caseId: caseRecord.id, kind: 'confirm', item: option.item, createdBy: req.user.username } })).find(same);
  }
  logger.info('AI finding confirmed', { caseId: caseRecord.id, item: option.item, username: req.user.username });
  res.json({ confirmation: row });
}

/**
 * POST /api/cases/:id/corrections/:feedbackId/trust — a second person agrees with a correction, so it may be used to
 * teach the AI later (E4-15). Super admin; never the person who made it (Q17 default: four eyes).
 */
async function trustCorrection(req, res) {
  const row = await AiFeedback.findOne({ where: { id: req.params.feedbackId, caseId: req.params.id } });
  if (!row) return res.status(404).json({ error: { message: 'Correction not found', status: 404 } });
  if (row.kind === 'confirm') {
    return res.status(400).json({ error: { message: 'A confirmation is not a correction — there is nothing to trust.', status: 400 } });
  }
  if (row.createdBy === req.user.username) {
    return res.status(403).json({ error: { message: 'Another person marks a correction trusted — not the one who made it.', status: 403 } });
  }
  if (row.trusted) return res.json({ correction: row });
  await row.update({ trusted: true, trustedBy: req.user.username, trustedAt: new Date() });
  logger.info('Correction marked trusted', { caseId: row.caseId, feedbackId: row.id, username: req.user.username });
  res.json({ correction: row });
}

module.exports = { createCorrection, createConfirmation, trustCorrection, correctionsInfo, CORRECTABLE_STATUSES };
