const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { evaluateDocumentChecks } = require('./checklist');

const BLOCK_NAME = 'document-checking';

async function logEvent(transaction, { caseId, prevStatus = null, newStatus, reasonCode = null, message = null }) {
  await CaseEvent.create({ caseId, blockName: BLOCK_NAME, prevStatus, newStatus, reasonCode, message }, { transaction });
}

/**
 * Pure — no I/O, no LLM. Takes a Case record, returns the outcome without persisting it,
 * so this can be reused identically by the real job and the dev preview endpoint.
 */
function checkCase(caseRecord) {
  if (!caseRecord.extractedFields) {
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached RECOGNIZED without extraction data)`);
  }

  const result = evaluateDocumentChecks(caseRecord.extractedFields);
  const outcome = result.passed ? 'DOCUMENT_CHECKED' : 'INCOMPLETE';

  return { caseId: caseRecord.id, outcome, result };
}

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    await Case.update(
      { currentStatus: outcome.outcome, documentCheckResult: outcome.result },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus: outcome.outcome,
      reasonCode: outcome.result.passed ? null : 'DOCUMENT_ISSUES_FOUND',
      message: outcome.result.passed ? 'All document checks passed' : outcome.result.issues.join('; '),
    });
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'RECOGNIZED' },
    limit: config.documentChecking.batchLimit,
    order: [['createdAt', 'ASC']],
  });

  const results = [];
  for (const caseRecord of cases) {
    try {
      const outcome = checkCase(caseRecord);
      await persistOutcome(caseRecord, outcome);
      results.push({ caseId: outcome.caseId, ok: true, outcome: outcome.outcome });
    } catch (error) {
      results.push({ caseId: caseRecord.id, ok: false, error: error.message });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).map((r) => ({ caseId: r.caseId, error: r.error }));
  return { processed, errors };
}

module.exports = { run, checkCase };
