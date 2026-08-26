const { Case, CaseEvent, EmailThread, EmailMessage, EmailAttachment } = require('../../db/models');
const { getStorageAdapter } = require('../../storage');
const { resetOneCase } = require('../dev/casesController');
const logger = require('../../utils/logger');

const BLOCK_NAME = 'case-review';

// Which status a manual override advances a case to — the next stage's own job picks it up
// naturally via its own Case.currentStatus filter, same as every other transition in this
// codebase (see modules/pipeline/service.js's STEPS comment: never call another block's
// service directly, only through DB status). This is deliberately just these two statuses —
// the ones a customer genuinely cannot always self-resolve (a false-positive document check,
// a stale/wrong IAS lookup) and that this project has no other escalation path for (see
// claim-recognition/service.js's applyMedicalRecordFallback comment: no manual-review state
// exists elsewhere in this project, by design).
const OVERRIDE_TARGETS = {
  INCOMPLETE: 'DOCUMENT_CHECKED',
  MEMBER_REVIEW_REQUIRED: 'MEMBER_VERIFIED',
};

const REVIEWABLE_STATUSES = Object.keys(OVERRIDE_TARGETS);

// Every Case.currentStatus value this project's jobs actually set (see jobs-registry.md) —
// used only to reject a typo'd ?status= filter with a helpful error, not to restrict which
// cases GET /api/cases can return. Keep in sync with jobs-registry.md if a job adds a status.
const KNOWN_STATUSES = [
  'EMAIL_RECEIVED',
  'ATTACHMENTS_STORED',
  'READY_FOR_DOCUMENT_READING',
  'RECOGNIZED',
  'MANUAL_REVIEW',
  'NOT_RECOGNIZED',
  'DOCUMENT_CHECKED',
  'INCOMPLETE',
  'MEMBER_VERIFIED',
  'MEMBER_REVIEW_REQUIRED',
  'CLAIM_PAYLOAD_PREPARED',
  'CLAIM_CREATED',
  'CLAIM_SUBMIT_FAILED',
];

// One-line summary for the list view — the specific thing a reviewer would need to glance
// at before deciding whether to open a case at all, or (for CLAIM_CREATED) the quickest
// "yes, this one actually worked" signal.
function summarize(caseRecord) {
  if (caseRecord.currentStatus === 'INCOMPLETE') {
    return caseRecord.documentCheckResult?.issues?.[0] ?? null;
  }
  if (caseRecord.currentStatus === 'MEMBER_REVIEW_REQUIRED') {
    return caseRecord.memberVerifyResult?.reasonCode ?? null;
  }
  if (caseRecord.currentStatus === 'CLAIM_CREATED') {
    return caseRecord.claimNo ? `Claim ${caseRecord.claimNo}` : null;
  }
  return null;
}

/**
 * GET /api/cases — cases at any status by default (a general "did the system process this
 * correctly" browser, not just the manual-review queue), newest-updated first. Optional
 * ?status=A,B narrows it — still accepted for the Needs-Review badge/filter use case.
 * Lightweight fields only — full detail (extractedFields can be large) is getCase below.
 */
async function listCases(req, res) {
  const statusParam = req.query.status;
  const statuses = statusParam
    ? String(statusParam)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (statuses) {
    const invalid = statuses.filter((s) => !KNOWN_STATUSES.includes(s));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: {
          message: `Unknown status filter(s): ${invalid.join(', ')}. Must be one of: ${KNOWN_STATUSES.join(', ')}`,
          status: 400,
        },
      });
    }
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const { rows, count } = await Case.findAndCountAll({
    where: statuses ? { currentStatus: statuses } : undefined,
    attributes: ['id', 'currentStatus', 'recognizedType', 'documentCheckResult', 'memberVerifyResult', 'claimNo', 'updatedAt'],
    order: [['updatedAt', 'DESC']],
    limit,
    offset,
  });

  const cases = rows.map((row) => ({
    id: row.id,
    currentStatus: row.currentStatus,
    recognizedType: row.recognizedType,
    updatedAt: row.updatedAt,
    summary: summarize(row),
  }));

  res.json({ cases, total: count, limit, offset });
}

/**
 * GET /api/cases/:id — full case detail, its CaseEvent audit timeline, and its email
 * thread(s)/message(s)/attachment(s) — everything needed to show "here's the email that came
 * in, here's what we extracted from it, here's what every job did with it" in one call.
 */
async function getCase(req, res) {
  const caseRecord = await Case.findByPk(req.params.id, {
    include: [{ model: EmailThread, include: [{ model: EmailMessage, include: [EmailAttachment] }] }],
    order: [[EmailThread, EmailMessage, 'receivedAt', 'ASC']],
  });
  if (!caseRecord) {
    return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  }

  const events = await CaseEvent.findAll({
    where: { caseId: caseRecord.id },
    order: [['createdAt', 'ASC']],
  });

  res.json({ case: caseRecord, events });
}

/**
 * GET /api/cases/:caseId/attachments/:attachmentId — streams one attachment's actual bytes.
 * The only place in this whole API that serves a file over HTTP; every other consumer
 * (claim-recognition's vision LLM call) reads storage internally, never over the network.
 * No auth (confirmed decision, same Day-1 posture as the rest of this API) — attachments can
 * be real medical records/bank details, so :caseId is required in the path and checked
 * against the attachment's actual owning case, not just used for a nicer URL.
 */
async function getAttachment(req, res) {
  const { caseId, attachmentId } = req.params;

  const attachment = await EmailAttachment.findByPk(attachmentId, {
    include: [{ model: EmailMessage, include: [EmailThread] }],
  });

  // Deliberately not a `where: { caseId }` on the nested EmailThread include above —
  // verified that Sequelize's subquery-based pagination for a top-level findByPk with a
  // hasMany-chain include does NOT reliably use a nested include's `where` to filter which
  // top-level row comes back (a known Sequelize gotcha, confirmed here: it returned the
  // attachment even for a caseId that didn't own it). Checking ownership explicitly in code
  // instead is slower by one comparison, not by one query, and is unambiguous.
  if (!attachment || attachment.EmailMessage?.EmailThread?.caseId !== caseId) {
    return res.status(404).json({ error: { message: `Attachment ${attachmentId} not found on case ${caseId}`, status: 404 } });
  }

  const storage = getStorageAdapter();
  const bytes = await storage.get(attachment.storageRef);

  const inline = /^application\/pdf$|^image\//.test(attachment.contentType || '');
  // originalFilename is whatever the sender's mail client sent — untrusted text, not
  // generated by this system. Strip quotes/control characters before it goes into a
  // quoted Content-Disposition value so it can't produce a malformed header.
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point here
  const safeFilename = (attachment.originalFilename || attachmentId).replace(/[\x00-\x1f"]/g, '');
  res.set('Content-Type', attachment.contentType || 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`);
  res.send(bytes);
}

/**
 * POST /api/cases/:id/override — human-in-the-loop bypass for a case stuck at INCOMPLETE or
 * MEMBER_REVIEW_REQUIRED. Advances Case.currentStatus straight to the next stage's own input
 * status — a pure status write, so the next scheduled job picks it up with no special
 * handling. Requires both a written reason and an operator name: no real auth/user system
 * exists anywhere in this project yet (confirmed 2026-08-25, controllers/users/usersController.js
 * is an unwired scaffold) — operatorName is plain, unauthenticated free text, a stopgap for
 * *some* accountability in the audit trail rather than none, not real auth. Both fields, plus
 * a snapshot of exactly what was being waived, go into one CaseEvent so the audit record is
 * self-contained without needing to cross-reference the case's prior state.
 */
async function overrideCase(req, res) {
  const { reason, operatorName } = req.body || {};

  if (typeof reason !== 'string' || reason.trim() === '') {
    return res.status(400).json({ error: { message: '"reason" is required', status: 400 } });
  }
  if (typeof operatorName !== 'string' || operatorName.trim() === '') {
    return res.status(400).json({ error: { message: '"operatorName" is required', status: 400 } });
  }

  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) {
    return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  }

  const targetStatus = OVERRIDE_TARGETS[caseRecord.currentStatus];
  if (!targetStatus) {
    return res.status(400).json({
      error: {
        message: `Case ${caseRecord.id} is at "${caseRecord.currentStatus}", not a reviewable status (${REVIEWABLE_STATUSES.join(', ')})`,
        status: 400,
      },
    });
  }

  const prevStatus = caseRecord.currentStatus;
  const waived = summarize(caseRecord);

  await Case.update({ currentStatus: targetStatus }, { where: { id: caseRecord.id } });
  await CaseEvent.create({
    caseId: caseRecord.id,
    blockName: BLOCK_NAME,
    prevStatus,
    newStatus: targetStatus,
    reasonCode: 'MANUAL_OVERRIDE',
    message: `Overridden by ${operatorName.trim()}: ${reason.trim()}${waived ? ` (waived: ${waived})` : ''}`,
  });

  logger.info('Case manually overridden', { caseId: caseRecord.id, prevStatus, targetStatus, operatorName: operatorName.trim() });

  res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: targetStatus });
}

/**
 * POST /api/cases/:id/reset — always rewinds to READY_FOR_DOCUMENT_READING, clearing
 * recognizedType/extractedFields/documentCheckResult and everything downstream, so the next
 * pipeline run reprocesses the case from claim-recognition onward as if it were freshly
 * submitted. Thin wrapper over resetOneCase (controllers/dev/casesController.js) — same
 * logic/safety checks (refuses a case that already has a real IAS claimNo) as the dev batch
 * reset tool, just single-case and reachable from the console UI without hitting /api/dev.
 */
async function resetCase(req, res) {
  try {
    const result = await resetOneCase(req.params.id, 'READY_FOR_DOCUMENT_READING', { source: 'console' });
    logger.info('Case manually reset', { caseId: result.caseId, previousStatus: result.previousStatus });
    res.json(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: { message: error.message, status: 404 } });
    }
    // Only remaining failure mode is the claimNo guard — a real, already-created IAS claim.
    res.status(409).json({ error: { message: error.message, status: 409 } });
  }
}

module.exports = { listCases, getCase, getAttachment, overrideCase, resetCase, OVERRIDE_TARGETS, REVIEWABLE_STATUSES };
