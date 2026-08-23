const { Case, CaseEvent } = require('../../db/models');
const logger = require('../../utils/logger');

const BLOCK_NAME = 'dev-reset';

// Every field any stage from member-verification onward computes — cleared on top of
// whichever stage-specific fields a given reset target adds below, so resetting never
// leaves stale data from a prior run sitting around implying work that hasn't actually
// happened yet (previously this stopped at documentCheckResult, missing everything
// member-verification/ias-claim-preparation/ias-claim-creation had written).
const DOWNSTREAM_FIELDS = ['memberVerifyResult', 'iasMemberInfoResponse', 'iasClaimPayload', 'claimNo', 'iasClaimResult'];

/**
 * Which fields get cleared when resetting TO a given status — everything that status's
 * own stage (and anything downstream of it) would have computed, so no stale data from
 * a prior run sits around implying work that hasn't actually happened yet.
 */
const RESET_FIELDS = {
  READY_FOR_DOCUMENT_READING: ['recognizedType', 'extractedFields', 'documentCheckResult', ...DOWNSTREAM_FIELDS],
  RECOGNIZED: ['documentCheckResult', ...DOWNSTREAM_FIELDS],
};

const VALID_STATUSES = Object.keys(RESET_FIELDS);

async function resetOneCase(caseId, to) {
  const caseRecord = await Case.findByPk(caseId);
  if (!caseRecord) {
    throw new Error(`Case ${caseId} not found`);
  }

  // A real, non-idempotent claim already exists in IAS for this case — resetting would
  // silently null out our only record of it (claimNo) while reprocessing could go on to
  // submit a second, duplicate claim to IAS. Refuse rather than clear; a case in this state
  // needs a deliberate manual decision, not a routine dev reset.
  if (caseRecord.claimNo) {
    throw new Error(
      `Case ${caseId} already has a real IAS claim number (claimNo=${caseRecord.claimNo}) — refusing to reset. ` +
        'Resetting would erase the only local record of an already-created, non-idempotent external claim.'
    );
  }

  const clearedFields = RESET_FIELDS[to];
  const previousStatus = caseRecord.currentStatus;
  const updates = { currentStatus: to };
  for (const field of clearedFields) updates[field] = null;

  await Case.update(updates, { where: { id: caseId } });
  await CaseEvent.create({
    caseId,
    blockName: BLOCK_NAME,
    prevStatus: previousStatus,
    newStatus: to,
    reasonCode: 'MANUAL_RESET',
    message: `Reset via dev tool, cleared: ${clearedFields.join(', ')}`,
  });

  return { caseId, previousStatus, currentStatus: to, clearedFields };
}

/**
 * Developer-only: rewinds one or more cases to an earlier pipeline stage so they get
 * picked up and reprocessed by that stage's job again — e.g. after a bugfix, replay
 * already-processed real cases instead of waiting for new test data. Each case is
 * processed independently (one not-found/invalid id doesn't fail the rest of the batch),
 * and every reset logs its own CaseEvent so this is never silent/untraceable.
 */
async function resetCases(req, res) {
  const { caseIds, to } = req.body || {};

  if (!VALID_STATUSES.includes(to)) {
    return res.status(400).json({
      error: { message: `"to" must be one of: ${VALID_STATUSES.join(', ')}`, status: 400 },
    });
  }

  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    return res.status(400).json({ error: { message: '"caseIds" must be a non-empty array', status: 400 } });
  }

  const results = [];
  for (const caseId of caseIds) {
    try {
      results.push({ ok: true, ...(await resetOneCase(caseId, to)) });
    } catch (error) {
      logger.error('case reset failed', { caseId, error: error.message, stack: error.stack });
      results.push({ ok: false, caseId, error: error.message });
    }
  }

  res.json({ results });
}

module.exports = { resetCases, VALID_STATUSES };
