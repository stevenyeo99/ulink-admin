const { sequelize, Case, CaseEvent } = require('../../db/models');
const config = require('../../config');
const { evaluateDocumentChecks } = require('./checklist');
const { queueDedupedTask } = require('../shared/emailTaskQueue');

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
    throw new Error(`Case ${caseRecord.id} has no extractedFields (reached READY_FOR_DOCUMENT_CHECKING without extraction data)`);
  }

  const result = evaluateDocumentChecks(caseRecord.extractedFields);
  const outcome = result.passed ? 'DOCUMENT_CHECKED' : 'INCOMPLETE';

  return { caseId: caseRecord.id, outcome, result };
}

/**
 * Signature of the issue list so a re-check that finds the exact same problems doesn't
 * queue a duplicate email — only an actual change in what's wrong (customer replied with
 * some but not all documents, etc.) queues a fresh one.
 */
function issuesDedupeKey(issues) {
  return [...issues].sort().join('|');
}

async function queueMissingDocumentsEmail(transaction, caseId, result) {
  await queueDedupedTask(transaction, {
    caseId,
    taskType: 'MISSING_DOCUMENTS',
    dedupeKey: issuesDedupeKey(result.issues),
    payload: { issues: result.issues },
  });
}

async function queueCompleteAckEmail(transaction, caseId) {
  await queueDedupedTask(transaction, { caseId, taskType: 'DOCUMENT_COMPLETE_ACK', dedupeKey: null, payload: {} });
}

// checkCase()'s own outcome names (DOCUMENT_CHECKED/INCOMPLETE) describe what this block
// itself concluded — kept as-is (dev preview endpoint documents this exact enum, see
// routes/dev/documentChecking.js) and are NOT the Case.currentStatus to write. Since this
// block now runs after member-verification (swapped 2026-09-01) and is the last of the two
// checks, a pass here is what sets the real MEMBER_VERIFIED gate ias-claim-preparation
// reads — not a status named after this block.
const OUTCOME_TO_STATUS = {
  DOCUMENT_CHECKED: 'MEMBER_VERIFIED',
  INCOMPLETE: 'INCOMPLETE',
};

async function persistOutcome(caseRecord, outcome) {
  return sequelize.transaction(async (transaction) => {
    const prevStatus = caseRecord.currentStatus;
    const newStatus = OUTCOME_TO_STATUS[outcome.outcome];
    await Case.update(
      { currentStatus: newStatus, documentCheckResult: outcome.result },
      { where: { id: caseRecord.id }, transaction }
    );
    await logEvent(transaction, {
      caseId: caseRecord.id,
      prevStatus,
      newStatus,
      reasonCode: outcome.result.passed ? null : 'DOCUMENT_ISSUES_FOUND',
      message: outcome.result.passed ? 'All document checks passed' : outcome.result.issues.join('; '),
    });

    if (outcome.result.passed) {
      // Both checks have now passed (member-verification already passed this case earlier
      // in the same run/an earlier run, or this case wouldn't be at READY_FOR_DOCUMENT_CHECKING) —
      // this block is the final gate now, so it's the one that queues the "complete"
      // acknowledgement. Previously queued by member-verification/service.js; moved here
      // when the step order swapped.
      await queueCompleteAckEmail(transaction, caseRecord.id);
    } else {
      await queueMissingDocumentsEmail(transaction, caseRecord.id, outcome.result);
    }
  });
}

async function run() {
  const cases = await Case.findAll({
    where: { currentStatus: 'READY_FOR_DOCUMENT_CHECKING' },
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
