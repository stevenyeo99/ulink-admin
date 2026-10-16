const { sequelize, Case, CaseEvent, ApiCaseStep, CaseRequest } = require('../../db/models');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { REQUEST_FROM, validateLines, openRequests, withRequests, requestedDedupeKey } = require('../../modules/case-requests/requests');
const { queueMissingDocumentsEmail, queueDocumentsIncompleteEmail } = require('../../modules/document-checking/service');
const { emailFor } = require('../../modules/api-document-checking/service');
const { buildAssessmentSummary, assessmentSummaryText } = require('../../modules/assessment-summary/summary');
const { requiredComment } = require('./casesController');
const { endClaim } = require('../../modules/case-claim/claim');
const logger = require('../../utils/logger');

const BLOCK_NAME = 'case-review';
const operatorOf = (user) => (user.name ? `${user.name} (${user.username})` : user.username);
const changed = (res) => res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });

/**
 * POST /api/cases/:id/request-information — a reviewer's own checklist lines on this case (SYSTEM_4 E4-28).
 * Body: { lines: [text], comment }. From the documents review statuses (REQUEST_FROM): the new lines replace the open
 * ones, the case goes to its flow's waiting-for-documents path, and the team is emailed to contact the customer about
 * the lines — they are never in the customer's email. The AI's own missing items go to the customer as usual (held
 * ones from a *Check before emailing* status too). Super admin, like the other review actions.
 */
async function requestInformation(req, res) {
  const comment = requiredComment(req, res, 'you are asking for this');
  if (comment === null) return undefined;
  const checked = validateLines(req.body?.lines);
  if (checked.error) return res.status(400).json({ error: { message: checked.error, status: 400 } });
  const { lines } = checked;

  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const prevStatus = caseRecord.currentStatus;
  const target = REQUEST_FROM[prevStatus];
  if (!target) {
    return res.status(400).json({ error: { message: 'More information can be requested only while the documents wait for a person to check them.', status: 400 } });
  }

  const operator = operatorOf(req.user);
  const isApi = caseRecord.source === 'API';
  const steps = isApi ? await ApiCaseStep.findAll({ where: { caseId: caseRecord.id } }) : [];
  const fields = isApi ? { ...caseRecord.toJSON(), ...apiCaseView(steps) } : caseRecord;
  if (!fields.documentCheckResult) return res.status(409).json({ error: { message: 'This case has no document check yet.', status: 409 } });
  const now = new Date();

  const moved = await sequelize.transaction(async (transaction) => {
    const [count] = await Case.update({ currentStatus: target }, { where: { id: caseRecord.id, currentStatus: prevStatus }, transaction });
    if (count !== 1) return false;
    // The new list replaces the open one (the form started from it).
    await CaseRequest.update({ doneBy: operator, doneAt: now }, { where: { caseId: caseRecord.id, doneAt: null }, transaction });
    await CaseRequest.bulkCreate(lines.map((text) => ({ caseId: caseRecord.id, text, createdBy: operator })), { transaction });
    const result = withRequests(fields.documentCheckResult, await openRequests(caseRecord.id, transaction));
    await CaseEvent.create({
      caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus, newStatus: target, reasonCode: 'INFORMATION_REQUESTED',
      message: `Information requested by ${operator}: ${lines.join('; ')} — comment: ${comment}`,
    }, { transaction });

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
      input: { requestedBy: req.user.username, lines },
      output: { outcome: 'INCOMPLETE', documentCheckResult: result, checkedAt: lastCheck?.output?.checkedAt ?? null, email: emailFor(result) },
      startedAt: now, finishedAt: now,
    }, { transaction });
    const issues = result.passed ? [] : result.issues;
    const assessment = assessmentSummaryText(buildAssessmentSummary({ ...fields, currentStatus: target, documentCheckResult: result }));
    await ApiCaseStep.create({
      caseId: caseRecord.id, job: BLOCK_NAME, status: 'DONE',
      input: { username: req.user.username, action: 'request-information', lines, comment },
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
  });
  if (!moved) return changed(res);

  await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
  logger.info('Information requested', { caseId: caseRecord.id, lines: lines.length, username: req.user.username });
  return res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: target });
}

module.exports = { requestInformation };
