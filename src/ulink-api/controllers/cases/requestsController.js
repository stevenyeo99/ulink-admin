const { sequelize, Case, CaseEvent, ApiCaseStep, CaseRequest } = require('../../db/models');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { REQUEST_FROM, staysAt, MAX_LINES, validateLines, openRequests, withRequests, requestedDedupeKey, closeRequests, refreshRequestLine } = require('../../modules/case-requests/requests');
const { emailDraft } = require('../../modules/case-requests/emailDraft');
const { queueMissingDocumentsEmail, queueDocumentsIncompleteEmail } = require('../../modules/document-checking/service');
const { emailFor } = require('../../modules/api-document-checking/service');
const { buildAssessmentSummary, assessmentSummaryText } = require('../../modules/assessment-summary/summary');
const { requiredComment } = require('./casesController');
const { endClaim } = require('../../modules/case-claim/claim');
const { markFor, BEING_CHECKED } = require('../../modules/review-lane/marker');
const reviewLane = () => require('../../modules/review-lane/lane'); // at call time: the lane loads every job module
const logger = require('../../utils/logger');

const BLOCK_NAME = 'case-review';
const operatorOf = (user) => (user.name ? `${user.name} (${user.username})` : user.username);
const changed = (res) => res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });

/**
 * POST /api/cases/:id/request-information — change the reviewer checklist of this case and ask for it (SYSTEM_4 E4-28,
 * E4-29). Body: { add: [text], remove: [line id], comment }. Only the change is applied: new lines added, removed ones
 * closed as *removed*, the rest kept with their author and date; at least one line stays open. From the documents
 * review statuses (REQUEST_FROM) the case goes to its flow's waiting-for-documents path, and the team is emailed to
 * contact the customer about the open lines — they are never in the customer's email. The AI's own missing items go
 * to the customer as usual (held ones from a *Check before emailing* status too). Where the case stays
 * (API_PREPARATION_REVIEW): only the lines and their copy on the check result change; the suspended revision after the
 * person's decision there emails the team. Super admin.
 */
async function requestInformation(req, res) {
  const comment = requiredComment(req, res, 'you are asking for this');
  if (comment === null) return undefined;
  const checked = validateLines(req.body?.add, { allowEmpty: true });
  if (checked.error) return res.status(400).json({ error: { message: checked.error, status: 400 } });
  const removeIds = [...new Set((Array.isArray(req.body?.remove) ? req.body.remove : []).filter((id) => typeof id === 'string'))];

  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  if (caseRecord.reviewPendingAt) return res.status(409).json({ error: { message: BEING_CHECKED, status: 409 } });
  const prevStatus = caseRecord.currentStatus;
  const target = REQUEST_FROM[prevStatus];
  if (!target) {
    return res.status(400).json({ error: { message: 'More information can be requested only while the documents or the claim preparation wait for a person.', status: 400 } });
  }
  const stays = staysAt(prevStatus);

  const before = await openRequests(caseRecord.id);
  const removed = before.filter((r) => removeIds.includes(r.id));
  // A line already open is not added twice.
  const added = checked.lines.filter((text) => !before.some((r) => r.text === text && !removeIds.includes(r.id)));
  if (removed.length !== removeIds.length) return changed(res);
  const openAfter = before.length - removed.length + added.length;
  if (!added.length && !removed.length) return res.status(400).json({ error: { message: 'Nothing changed: add a line or remove one.', status: 400 } });
  if (openAfter === 0 && !stays) return res.status(400).json({ error: { message: 'Every line would be removed. To let the case continue, confirm the documents instead.', status: 400 } });
  if (openAfter > MAX_LINES) return res.status(400).json({ error: { message: `At most ${MAX_LINES} open lines.`, status: 400 } });

  const operator = operatorOf(req.user);
  const isApi = caseRecord.source === 'API';
  const steps = isApi ? await ApiCaseStep.findAll({ where: { caseId: caseRecord.id } }) : [];
  const fields = isApi ? { ...caseRecord.toJSON(), ...apiCaseView(steps) } : caseRecord;
  if (!fields.documentCheckResult) return res.status(409).json({ error: { message: 'This case has no document check yet.', status: 409 } });
  const now = new Date();

  const STALE = new Error('lines changed');
  const moved = await sequelize.transaction(async (transaction) => {
    // Where the case stays, the update only guards that it is still there: not marked for the review lane.
    const [count] = await Case.update({ currentStatus: target, ...(stays ? {} : markFor(caseRecord, operator)) }, { where: { id: caseRecord.id, currentStatus: prevStatus }, transaction });
    if (count !== 1) return false;
    // Only the change: unchanged lines keep their author and date.
    // A line closed meanwhile (e.g. marked done): roll back, the person reloads.
    if (removed.length && (await closeRequests(caseRecord.id, { ids: removed.map((r) => r.id), as: 'removed', by: operator }, transaction)) !== removed.length) throw STALE;
    if (added.length) await CaseRequest.bulkCreate(added.map((text) => ({ caseId: caseRecord.id, text, createdBy: operator })), { transaction });
    const open = await openRequests(caseRecord.id, transaction);
    const lines = open.map((r) => r.text);
    const result = withRequests(fields.documentCheckResult, open);
    const change = [added.length ? `added: ${added.join('; ')}` : null, removed.length ? `removed: ${removed.map((r) => r.text).join('; ')}` : null].filter(Boolean).join(' — ');
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus, newStatus: target, reasonCode: 'INFORMATION_REQUESTED',
      message: `Information requested by ${operator} (${change}); open: ${lines.length ? lines.join('; ') : 'none'} — comment: ${comment}`,
    }, { transaction });
    if (stays) {
      await refreshRequestLine(caseRecord, transaction);
      return true;
    }

    if (!isApi) {
      await Case.update({ documentCheckResult: result }, { where: { id: caseRecord.id }, transaction });
      if (!result.passed) await queueMissingDocumentsEmail(transaction, caseRecord.id, result);
      await queueDocumentsIncompleteEmail(transaction, caseRecord, result, { status: target, requested: lines });
      return true;
    }

    // API: a document-check step with the lines — outcome INCOMPLETE, so the IAS revision is sent with suspense — and
    // the AI's own missing items to the customer as the check would (api-email-sender applies the customer-email switch).
    const lastCheck = steps.filter((s) => s.job === 'api-document-checking' && s.status === 'DONE')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: 'api-document-checking', status: 'DONE',
      input: { requestedBy: req.user.username, added, removed: removed.map((r) => r.id) },
      output: { outcome: 'INCOMPLETE', documentCheckResult: result, checkedAt: lastCheck?.output?.checkedAt ?? null, email: emailFor(result) },
      startedAt: now, finishedAt: now,
    }, { transaction });
    const issues = result.passed ? [] : result.issues;
    const assessment = assessmentSummaryText(buildAssessmentSummary({ ...fields, currentStatus: target, documentCheckResult: result }));
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: BLOCK_NAME, status: 'DONE',
      input: { username: req.user.username, action: 'request-information', added, removed: removed.map((r) => r.id), comment },
      output: {
        email: {
          taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal',
          payload: { caseId: caseRecord.id, claimNo: caseRecord.claimNo, issues, requested: lines, assessment },
          dedupeKey: requestedDedupeKey(lines, issues),
        },
      },
      startedAt: now, finishedAt: now,
    }, { transaction });
    return true;
  }).catch((err) => { if (err === STALE) return false; throw err; });
  if (!moved) return changed(res);

  if (!stays) {
    await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
    reviewLane().triggerReviewLane(caseRecord.source); // SYSTEM_5 review lane: processed at once
  }
  logger.info('Information requested', { caseId: caseRecord.id, added: added.length, removed: removed.length, username: req.user.username });
  return res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: target });
}

/**
 * POST /api/cases/:id/requests/:requestId/done — one reviewer line is done: the documents for it arrived (SYSTEM_4
 * E4-29). Body: { comment }. Any status; the case does not move — at *Check the AI's documents finding* a person still
 * confirms to continue. Super admin.
 */
async function markRequestDone(req, res) {
  const comment = requiredComment(req, res, 'this line is done');
  if (comment === null) return undefined;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const line = (await openRequests(caseRecord.id)).find((r) => r.id === req.params.requestId);
  if (!line) return changed(res);
  const operator = operatorOf(req.user);

  const closed = await sequelize.transaction(async (transaction) => {
    if (!(await closeRequests(caseRecord.id, { ids: [line.id], as: 'done', by: operator }, transaction))) return false;
    await refreshRequestLine(caseRecord, transaction);
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: caseRecord.currentStatus, newStatus: caseRecord.currentStatus,
      reasonCode: 'REQUEST_DONE', message: `Reviewer checklist line done (${operator}): ${line.text} — comment: ${comment}`,
    }, { transaction });
    return true;
  });
  if (!closed) return changed(res);
  logger.info('Reviewer checklist line done', { caseId: caseRecord.id, requestId: line.id, username: req.user.username });
  return res.json({ caseId: caseRecord.id, requestId: line.id, closedAs: 'done' });
}

/**
 * POST /api/cases/:id/email-draft — the customer missing-documents email as it would read now, to copy (SYSTEM_4
 * E4-29). Body: { lines?: [text] } — the reviewer lines being edited (left out: the open ones saved). Read-only; any
 * logged-in user.
 */
async function getEmailDraft(req, res) {
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  let lines = null;
  if (req.body?.lines !== undefined) {
    const checked = validateLines(req.body.lines, { allowEmpty: true });
    if (checked.error) return res.status(400).json({ error: { message: checked.error, status: 400 } });
    lines = checked.lines;
  }
  return res.json(await emailDraft(caseRecord, lines));
}

module.exports = { requestInformation, markRequestDone, getEmailDraft };
