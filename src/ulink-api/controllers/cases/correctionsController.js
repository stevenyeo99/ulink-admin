const { sequelize, Case, CaseEvent, ApiCaseStep, AiFeedback, CaseRequest } = require('../../db/models');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { OVERRIDE_TARGETS } = require('../../modules/case-override/override');
const { correctionOptions, validateCorrection, aiOriginal, applyCorrection, correctionText, recheckFrom, reasonLongEnough, REASON_TOO_SHORT, failedCodes } = require('../../modules/ai-feedback/corrections');
const { REQUEST_FROM, MAX_LINES, validateLines, openRequests } = require('../../modules/case-requests/requests');
const logger = require('../../utils/logger');

// Per-item correction (SYSTEM_4 E4-12, E4-15 step 1). Allowed where a whole-check override is (a member or document
// finding stopped the case), by the same people (super admin — a corrected bank account or amount reaches the claim).
// Several findings are corrected in one go (owner, 2026-10-20: not one per pipeline run — the review page's "Save all and
// check again"), and the case is checked once with all of them — from the member check when one of them is a value it
// compares with IAS, else from the document check (corrections.js recheckFrom). No IAS write here
// (Q16: a correction changes our checks, decision and AI remark; the claim built later uses the corrected fields).
// While a member or document finding holds the case, and while it waits for the customer (owner, 2026-10-19: a value
// the AI read wrong is corrected before the claim goes — or goes again — to IAS; email INCOMPLETE is an override
// status already). After the correction the case is checked again: documents complete → claim preparation and (API)
// a new IAS revision that lifts the suspense; documents still missing → it waits for that person, who sends the
// request (correctionHold — a correction never emails the customer on its own).
// API_PREPARATION_REVIEW: a finding the reviewer still sees wrong at the claim-preparation stop is corrected there too.
// BENEFIT_REVIEW: a misread voucher amount is corrected beside the head choice (SYSTEM_5 member balance phase C).
// BALANCE_REVIEW: the balance dropped before the claim — only its bypass (member:balance) is offered (SYSTEM_5 phase D).
const CORRECTABLE_STATUSES = [...new Set([...Object.keys(OVERRIDE_TARGETS), 'API_CLAIM_SUSPENDED', 'INCOMPLETE', 'API_PREPARATION_REVIEW', 'BENEFIT_REVIEW', 'API_BENEFIT_REVIEW', 'BALANCE_REVIEW', 'API_BALANCE_REVIEW'])];
const balanceHeld = (status) => /BALANCE_REVIEW$/.test(status || '');
// The stops where every open finding needs a decision before the save (SYSTEM_5 review actions 4.8, owner 2026-10-27):
// an open finding left out would hold the case again at the next check. Not the benefit, balance and claim preparation
// stops, whose panels save only what they show.
const DECIDE_ALL_STATUSES = new Set(['MEMBER_REVIEW_REQUIRED', 'API_MEMBER_REVIEW_REQUIRED', 'DOCUMENTS_REVIEW', 'API_DOCUMENTS_REVIEW', 'DOCUMENTS_UNSURE', 'API_DOCUMENTS_UNSURE']);
// Ask the customer (4.9): only where the documents are missing and wait for a person.
const ASK_STATUSES = new Set(['DOCUMENTS_REVIEW', 'API_DOCUMENTS_REVIEW']);
const RECOGNITION_JOB = 'api-claim-recognition';

// Member findings are marked OK only while the member check holds the case — after a whole-check override the case is
// past it, and a Mark OK there would send it back through the member check.
// At BALANCE_REVIEW the finding is claim preparation's (claimPrepMeta.balance.issue), offered the same way.
const heldByMember = (fields) => {
  if (balanceHeld(fields.currentStatus)) return fields.claimPrepMeta?.balance?.issue ? { issues: [fields.claimPrepMeta.balance.issue] } : null;
  return /MEMBER_REVIEW_REQUIRED$/.test(fields.currentStatus || '') ? fields.memberVerifyResult : null;
};

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
  const options = fields.extractedFields ? correctionOptions(fields.extractedFields, fields.documentCheckResult, heldByMember(fields)) : [];
  // BALANCE_REVIEW: only the balance finding's bypass (the documents are already in the IAS console).
  return { allowed, options: balanceHeld(fields.currentStatus) ? options.filter((o) => o.item === 'member:balance') : options, list };
}

// Where "check again" starts for these corrected items: the member check when one of them is a value it compares with
// IAS (or the member check holds the case), else the document check.
function recheckTarget(items, prevStatus, source) {
  const rechecks = items.map((item) => recheckFrom(item, prevStatus));
  const recheck = rechecks.find((r) => r.API === 'API_RECOGNIZED') || rechecks[0];
  return { label: recheck.label, status: recheck[source === 'API' ? 'API' : 'EMAIL'] };
}

// The open findings that the save leaves without a decision, as labels (4.8): every member finding the case offers, and
// every failed document line — decided by its own verdict, a revised value it compared (editItems), or Ask the customer.
function undecided(fields, options, items, askCustomer) {
  const decided = new Set(items.map((i) => i?.item));
  const asked = new Set(askCustomer.map((a) => a.item));
  const member = options.filter((o) => o.item.startsWith('member:') && !decided.has(o.item)).map((o) => o.label);
  if (!/DOCUMENTS_(REVIEW|UNSURE)$/.test(fields.currentStatus)) return member;
  const lines = (fields.documentCheckResult?.checklist || []).filter((l) => l.passed === false);
  const documents = failedCodes(fields.documentCheckResult)
    .filter((code) => !decided.has(code) && !asked.has(code)
      && !lines.filter((l) => l.code === code).some((l) => (l.editItems || []).some((item) => decided.has(item))))
    .map((code) => lines.find((l) => l.code === code)?.label || code);
  return [...member, ...new Set(documents)];
}

/**
 * Saves corrections ([{ kind: value|verdict, item, value? | passed?, reason, wrongStep }]) on a held case — all or none:
 * every item is checked first — and checks the case again once. Responds itself; returns nothing.
 * askCustomer ([{ item: check code, reason }]) and requestLines ([text]): the review page's Ask the customer and the
 * reviewer's own lines (SYSTEM_5 review actions 4.9, 4.10), saved with the same save.
 */
async function saveCorrections(req, res, items, { askCustomer = [], requestLines = [] } = {}) {
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (!CORRECTABLE_STATUSES.includes(caseRecord.currentStatus)) {
    return res.status(400).json({ error: { message: 'Corrections are made while a member or document finding holds the case, or while it waits for the customer.', status: 400 } });
  }
  const { fields, recognitionStep } = await caseFields(caseRecord);
  if (!fields.extractedFields || (caseRecord.source === 'API' && !recognitionStep)) {
    return res.status(400).json({ error: { message: 'The AI has not read this case yet — nothing to correct.', status: 400 } });
  }

  const options = correctionOptions(fields.extractedFields, fields.documentCheckResult, heldByMember(fields));
  const checked = [];
  if (balanceHeld(caseRecord.currentStatus) && items.some((body) => body?.item !== 'member:balance')) {
    return res.status(400).json({ error: { message: 'Here the only action is to bypass the balance finding: the documents are already in the IAS console.', status: 400 } });
  }
  for (const [i, body] of items.entries()) {
    const result = validateCorrection(body, options);
    const error = result.error || (checked.some((c) => c.option.item === body.item) && `${result.option.label} is changed twice.`);
    // Several changes: named by what was changed (the page shows no numbers).
    const name = result.option?.label || options.find((o) => o.item === body?.item)?.label || `Change ${i + 1}`;
    if (error) return res.status(400).json({ error: { message: items.length > 1 && !error.startsWith(name) ? `${name}: ${error}` : error, status: 400 } });
    checked.push({ ...result, body });
  }

  const bad = (message) => res.status(400).json({ error: { message, status: 400 } });
  const prevStatus = caseRecord.currentStatus;
  // Ask the customer: a failed document line of this case, once, with a reason.
  const failedLines = (fields.documentCheckResult?.checklist || []).filter((l) => l.passed === false);
  if (askCustomer.length && !ASK_STATUSES.has(prevStatus)) return bad('Ask the customer is for a case whose documents are missing and wait for a person.');
  for (const ask of askCustomer) {
    const line = failedLines.find((l) => l.code === ask?.item && l.code !== 'PERSON_REQUEST');
    if (!line) return bad(`${ask?.item ?? 'This finding'} is not a failed finding of this case.`);
    if (askCustomer.filter((a) => a.item === ask.item).length > 1) return bad(`${line.label} is asked twice.`);
    if (checked.some((c) => c.option.item === ask.item)) return bad(`${line.label}: Mark OK and Ask the customer at once.`);
    if (!reasonLongEnough(ask.reason)) return bad(`${line.label}: ${REASON_TOO_SHORT}`);
  }
  // The reviewer's own lines: where a request can be made, and no more than the limit with the open ones.
  const newLines = validateLines(requestLines, { allowEmpty: true });
  if (newLines.error) return bad(newLines.error);
  const open = newLines.lines.length ? await openRequests(caseRecord.id) : [];
  const added = newLines.lines.filter((text) => !open.some((r) => r.text === text));
  if (added.length && !REQUEST_FROM[prevStatus]) return bad('Your own request lines are added while the documents wait for a person to check them.');
  if (open.length + added.length > MAX_LINES) return bad(`At most ${MAX_LINES} open request lines.`);
  // Every open finding decided first (4.8): one left out would bring the case back to the review queue.
  if (DECIDE_ALL_STATUSES.has(prevStatus)) {
    const left = undecided(fields, options, items, askCustomer);
    if (left.length) return res.status(400).json({ error: { message: `Decide every finding before you save. Still open: ${left.join('; ')}.`, status: 400, open: left } });
  }
  if (!checked.length && !askCustomer.length && !added.length) return bad('Send the changes to save.');

  const operator = operatorOf(req.user);
  // Nothing corrected (only Ask the customer or own lines): the document check runs again and sends the request.
  const target = checked.length
    ? recheckTarget(checked.map((c) => c.option.item), prevStatus, caseRecord.source)
    : { label: 'the document check', status: caseRecord.source === 'API' ? 'API_READY_FOR_DOCUMENT_CHECKING' : 'READY_FOR_DOCUMENT_CHECKING' };
  const newStatus = target.status;

  const rows = await sequelize.transaction(async (transaction) => {
    let { extractedFields } = fields;
    const saved = []; // { row, correction }
    for (const { option, corrected, body } of checked) {
      const original = aiOriginal(fields.extractedFields, option, fields.documentCheckResult);
      const row = await AiFeedback.create({
        caseId: caseRecord.id, kind: option.kind, item: option.item, label: option.label,
        aiValue: original.aiValue, aiConfidence: original.aiConfidence, correctedValue: corrected,
        reason: body.reason.trim(), wrongStep: body.wrongStep, page: original.page, createdBy: req.user.username,
      }, { transaction });
      const correction = {
        id: row.id, kind: option.kind, item: option.item, label: option.label, aiValue: original.aiValue,
        aiConfidence: original.aiConfidence, corrected, reason: row.reason, wrongStep: row.wrongStep, page: original.page,
        by: operator, at: row.createdAt,
        // A member Mark OK covers exactly the finding the person saw (member-verification/checks.js).
        // member:balance: the short vouchers it saw (coverKeys), not the balance figure.
        ...(option.item.startsWith('member:') ? { covers: option.note, ...(option.coverKeys ? { coverKeys: option.coverKeys } : {}) } : {}),
      };
      extractedFields = applyCorrection(extractedFields, correction);
      saved.push({ row, correction });
    }

    // Ask the customer and the reviewer's own lines (4.9, 4.10): stored on the fields for the next document check, which
    // sends the request instead of holding the case again (corrections.js askCovers, requestsReleased).
    // A later save with neither drops the old decision: it was for the check that sent that request.
    if (askCustomer.length || added.length) {
      extractedFields = { ...extractedFields, askCustomer: { codes: askCustomer.map((a) => a.item), by: operator, at: new Date().toISOString() } };
    } else if (extractedFields?.askCustomer) {
      const { askCustomer: _old, ...rest } = extractedFields;
      extractedFields = rest;
    }
    // Learning data: the AI was right to fail this check (one row per person and check, as a confirmation).
    const confirmed = askCustomer.length
      ? await AiFeedback.findAll({ where: { caseId: caseRecord.id, kind: 'confirm', item: askCustomer.map((a) => a.item), createdBy: req.user.username }, transaction })
      : [];
    for (const ask of askCustomer) {
      const line = failedLines.find((l) => l.code === ask.item);
      if (!confirmed.some((r) => r.item === ask.item && r.correctedValue === false)) {
        await AiFeedback.create({
          caseId: caseRecord.id, kind: 'confirm', item: ask.item, label: line.label, aiValue: false, aiConfidence: line.confidence ?? null,
          correctedValue: false, reason: ask.reason.trim(), wrongStep: null, page: null, createdBy: req.user.username,
        }, { transaction });
      }
      await CaseEvent.create({
        caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus: prevStatus, reasonCode: 'ASK_CUSTOMER',
        message: `Ask the customer: ${line.label}, by ${operator} — ${ask.reason.trim()}.`,
      }, { transaction });
    }
    if (added.length) {
      await CaseRequest.bulkCreate(added.map((text) => ({ caseId: caseRecord.id, text, createdBy: operator })), { transaction });
      await CaseEvent.create({
        caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus: prevStatus, reasonCode: 'INFORMATION_REQUESTED',
        message: `Information requested by ${operator}: ${added.join('; ')}.`,
      }, { transaction });
    }

    // Only if nothing moved the case meanwhile (same guard as override).
    const [count] = await Case.update(
      caseRecord.source === 'API' ? { currentStatus: newStatus } : { currentStatus: newStatus, extractedFields },
      { where: { id: caseRecord.id, currentStatus: prevStatus }, transaction }
    );
    if (count !== 1) throw Object.assign(new Error('moved'), { moved: true });
    for (const { correction } of saved) {
      await CaseEvent.create({
        caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus: prevStatus, reasonCode: 'MANUAL_CORRECTION',
        message: `${correctionText(correction)}.`,
      }, { transaction });
    }
    if (caseRecord.source === 'API') {
      // A new recognition step with the corrected fields: every later API job reads the latest one; the AI's own
      // step stays as it was.
      const now = new Date();
      await ApiCaseStep.create({
        caseId: caseRecord.id, job: RECOGNITION_JOB, status: 'DONE',
        input: { correction: saved[0]?.row.id ?? null, corrections: saved.map((s) => s.row.id), askCustomer: askCustomer.map((a) => a.item), username: req.user.username },
        output: { ...recognitionStep.output, extractedFields },
        startedAt: now, finishedAt: now,
      }, { transaction });
    }
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: 'case-review', prevStatus, newStatus, reasonCode: 'MANUAL_RECHECK',
      message: `Checked again from ${target.label} by ${operator}, with ${[
        saved.length ? `${saved.length} correction(s)` : null,
        askCustomer.length ? `${askCustomer.length} finding(s) to ask the customer` : null,
        added.length ? `${added.length} request line(s)` : null,
      ].filter(Boolean).join(', ')}.`,
    }, { transaction });
    return saved.map((s) => s.row);
  }).catch((error) => {
    if (error.moved) return null;
    throw error;
  });
  if (!rows) {
    return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  }

  logger.info('Case items corrected', { caseId: caseRecord.id, items: checked.map((c) => c.option.item), askCustomer: askCustomer.map((a) => a.item), requestLines: added.length, username: req.user.username });
  return res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: newStatus, correction: rows[0] ?? null, corrections: rows });
}

/**
 * POST /api/cases/:id/corrections — { kind: value|verdict, item, value? | passed?, reason, wrongStep }. One correction,
 * saved and checked again (the batch with one item).
 */
const createCorrection = (req, res) => saveCorrections(req, res, [req.body || {}]);

/**
 * POST /api/cases/:id/corrections/batch — { items: [correction, …] }. "Save all and check again" on the review page:
 * every change saved together (or none), and the case checked once.
 */
function createCorrections(req, res) {
  const items = req.body?.items ?? [];
  const askCustomer = req.body?.askCustomer ?? [];
  const requestLines = req.body?.requestLines ?? [];
  if (!Array.isArray(items) || !Array.isArray(askCustomer) || !Array.isArray(requestLines)
    || askCustomer.some((a) => !a || typeof a !== 'object' || typeof a.item !== 'string')
    || items.length + askCustomer.length + requestLines.length === 0 || items.length > 50 || askCustomer.length > 50) {
    return res.status(400).json({ error: { message: 'Send the changes to save (1 to 50).', status: 400 } });
  }
  return saveCorrections(req, res, items, { askCustomer, requestLines });
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
  // Mark OK on an unsure value needs a reason, as every review action does (SYSTEM_5 review actions, owner 2026-10-27).
  if (!reasonLongEnough(req.body?.reason)) return res.status(400).json({ error: { message: REASON_TOO_SHORT, status: 400 } });

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

  const reason = req.body.reason.trim();
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

module.exports = { createCorrection, createCorrections, createConfirmation, trustCorrection, correctionsInfo, CORRECTABLE_STATUSES };
