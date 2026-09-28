const { Op, fn, col, cast, where: sqlWhere, literal } = require('sequelize');
const { Case, CaseEvent, CaseDocument, ApiCaseStep, EmailThread, EmailMessage, EmailAttachment } = require('../../db/models');
const { todayInIasTimezone } = require('../../modules/shared/iasDates');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { buildAssessmentSummary } = require('../../modules/assessment-summary/summary');
const { queueEntry, REASON_ORDER } = require('../../modules/review-queue/queue');
const { CASE_STATUSES, MODULES, GROUPS, codesInGroup } = require('../../modules/case-status/catalog');


// Every status code the jobs set — rejects a typo'd ?status= filter with a helpful error.
const KNOWN_STATUSES = Object.keys(CASE_STATUSES);
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
// Swapped 2026-09-01 alongside the member-verification/document-checking step order:
// document-checking is now the last of the two checks, so overriding a stuck INCOMPLETE
// skips straight to the final MEMBER_VERIFIED gate. member-verification runs first now, so
// overriding a stuck MEMBER_REVIEW_REQUIRED sends the case into document-checking next
// (READY_FOR_DOCUMENT_CHECKING), same as if member-verification itself had passed it.
const OVERRIDE_TARGETS = {
  INCOMPLETE: 'MEMBER_VERIFIED',
  MEMBER_REVIEW_REQUIRED: 'READY_FOR_DOCUMENT_CHECKING',
};

const REVIEWABLE_STATUSES = Object.keys(OVERRIDE_TARGETS);

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

const CASE_SOURCES = ['EMAIL', 'API'];

// ?sort= values the list accepts → model attribute.
const SORTABLE = { updatedAt: 'updatedAt', createdAt: 'createdAt', claimNo: 'claimNo', status: 'currentStatus' };

// The case fields the assessment reads, for a batch of cases: email cases have them on the row; API
// cases keep them in their job steps, fetched in one query. Returns (caseRecord) => fields.
async function assessmentFieldsLoader(cases) {
  const apiIds = cases.filter((c) => c.source === 'API').map((c) => c.id);
  const steps = apiIds.length ? await ApiCaseStep.findAll({ where: { caseId: apiIds } }) : [];
  const stepsByCase = new Map();
  for (const step of steps) stepsByCase.set(step.caseId, [...(stepsByCase.get(step.caseId) || []), step]);
  return (c) => (c.source === 'API' ? apiCaseView(stepsByCase.get(c.id) || []) : c);
}

const listRow = (c) => ({
  id: c.id,
  source: c.source,
  currentStatus: c.currentStatus,
  claimNo: c.claimNo,
  tpaCaseNumber: c.tpaCaseNumber,
  recognizedType: c.recognizedType,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/**
 * GET /api/cases/approvals — non-STP claims waiting for JD2 to approve in IAS, oldest first, each with
 * its AI assessment's review points (what JD2 should look at before approving). Email cases: created
 * in IAS and not STP; API cases: revised in IAS with documents complete (API STP goes on to the CSR
 * instead). The system can't see JD2's approval in IAS, so a case stays here until something moves it.
 */
async function getApprovals(req, res) {
  const source = req.query.source ? String(req.query.source).toUpperCase() : null;
  if (source && !CASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: { message: `Unknown source filter: ${req.query.source}. Must be one of: ${CASE_SOURCES.join(', ')}`, status: 400 } });
  }
  const cases = await Case.findAll({
    where: {
      [Op.or]: [
        { currentStatus: 'CLAIM_CREATED', isStp: { [Op.not]: true } },
        { currentStatus: 'API_CLAIM_REVISED' },
      ],
      ...(source ? { source } : {}),
    },
    order: [['updatedAt', 'ASC']],
    limit: QUEUE_SCAN_LIMIT,
  });
  const fieldsOf = await assessmentFieldsLoader(cases);
  const items = cases.map((c) => {
    const { reviewPoints } = buildAssessmentSummary(fieldsOf(c));
    const points = reviewPoints.filter((p) => p.reason !== 'STP with open review points');
    return { ...listRow(c), reviewPoints: points.map((p) => `${p.decision}: ${p.check}`) };
  });
  res.json({ items, total: items.length });
}

// Statuses a queued case can be at: every open one, plus the IAS rejections (queue.js decides).
const QUEUE_CANDIDATE_STATUSES = [
  ...codesInGroup('in_progress'), ...codesInGroup('waiting_customer'), ...codesInGroup('needs_review'),
  'CLAIM_SUBMIT_FAILED', 'API_CLAIM_REVISION_FAILED',
];
// ponytail: the queue rebuilds each open case's assessment on every request, capped here; move to a
// stored summary / paged query once open cases run into the hundreds.
const QUEUE_SCAN_LIMIT = 500;

/**
 * GET /api/cases/review-queue — cases a person should look at, oldest first, each with the reason
 * and what to check (modules/review-queue/queue.js), plus a count per reason. Optional ?source=.
 */
async function getReviewQueue(req, res) {
  const source = req.query.source ? String(req.query.source).toUpperCase() : null;
  if (source && !CASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: { message: `Unknown source filter: ${req.query.source}. Must be one of: ${CASE_SOURCES.join(', ')}`, status: 400 } });
  }
  const cases = await Case.findAll({
    where: { currentStatus: QUEUE_CANDIDATE_STATUSES, ...(source ? { source } : {}) },
    order: [['updatedAt', 'ASC']],
    limit: QUEUE_SCAN_LIMIT,
  });

  const fieldsOf = await assessmentFieldsLoader(cases);
  const items = [];
  for (const c of cases) {
    const entry = queueEntry(c.currentStatus, fieldsOf(c));
    if (!entry) continue;
    items.push({ ...listRow(c), ...entry });
  }
  const counts = Object.fromEntries(REASON_ORDER.map((r) => [r, items.filter((i) => i.reason === r).length]));
  res.json({ items, counts, total: items.length });
}

/**
 * GET /api/cases/overview — the dashboard's numbers: cases per group (who acts next), and how many
 * arrived today (Myanmar time, the same day boundary IAS uses). Optional ?source=.
 */
async function getOverview(req, res) {
  const source = req.query.source ? String(req.query.source).toUpperCase() : null;
  if (source && !CASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: { message: `Unknown source filter: ${req.query.source}. Must be one of: ${CASE_SOURCES.join(', ')}`, status: 400 } });
  }
  const where = source ? { source } : {};

  const rows = await Case.findAll({
    where,
    attributes: ['currentStatus', [fn('COUNT', col('id')), 'count']],
    group: ['currentStatus'],
    raw: true,
  });
  const startOfToday = new Date(`${todayInIasTimezone()}T00:00:00+06:30`);
  const newToday = await Case.count({ where: { ...where, createdAt: { [Op.gte]: startOfToday } } });

  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count);
    const info = CASE_STATUSES[row.currentStatus];
    total += count;
    if (!info) continue; // an unknown status still counts toward the total
    groups[info.group] += count;
  }
  res.json({ total, newToday, groups });
}

/**
 * GET /api/cases/statuses — what each status code means to a person (label, description, module,
 * group), plus the module and group lists. The console shows these instead of raw codes.
 */
function getCaseStatuses(req, res) {
  res.json({ statuses: CASE_STATUSES, modules: MODULES, groups: GROUPS });
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

  // Optional ?source=EMAIL|API — the console's Email / API tabs. Omitted = both.
  const source = req.query.source ? String(req.query.source).toUpperCase() : null;
  if (source && !CASE_SOURCES.includes(source)) {
    return res.status(400).json({
      error: { message: `Unknown source filter: ${req.query.source}. Must be one of: ${CASE_SOURCES.join(', ')}`, status: 400 },
    });
  }

  // ?group= / ?module= — the status catalog's groups and modules (the console's filters and
  // dashboard links), turned into the status codes they cover.
  const group = req.query.group ? String(req.query.group) : null;
  const moduleId = req.query.module ? String(req.query.module) : null;
  if (group && !GROUPS.some((g) => g.id === group)) {
    return res.status(400).json({ error: { message: `Unknown group: ${group}. Must be one of: ${GROUPS.map((g) => g.id).join(', ')}`, status: 400 } });
  }
  if (moduleId && !MODULES.some((m) => m.id === moduleId)) {
    return res.status(400).json({ error: { message: `Unknown module: ${moduleId}. Must be one of: ${MODULES.map((m) => m.id).join(', ')}`, status: 400 } });
  }

  const sortBy = SORTABLE[req.query.sort] ? req.query.sort : 'updatedAt';
  const direction = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  let codes = statuses;
  const narrow = (allowed) => { codes = codes ? codes.filter((c) => allowed.includes(c)) : allowed; };
  if (group) narrow(codesInGroup(group));
  if (moduleId) narrow(KNOWN_STATUSES.filter((c) => CASE_STATUSES[c].module === moduleId));

  const where = {};
  if (codes) where.currentStatus = codes;
  if (source) where.source = source;

  // ?q= — free-text search over the identifiers people have in hand: claim no., TPA case number,
  // case id, and the claimant name the AI read (email cases keep it on the case row).
  const q = req.query.q ? String(req.query.q).trim() : '';
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where[Op.or] = [
      { claimNo: { [Op.iLike]: like } },
      { tpaCaseNumber: { [Op.iLike]: like } },
      sqlWhere(cast(col('Case.id'), 'text'), { [Op.iLike]: like }),
      sqlWhere(literal(`"Case"."extracted_fields"->'claimant'->>'claimant_name'`), { [Op.iLike]: like }),
    ];
  }

  const { rows, count } = await Case.findAndCountAll({
    where,
    attributes: ['id', 'currentStatus', 'source', 'tpaCaseNumber', 'recognizedType', 'documentCheckResult', 'memberVerifyResult', 'claimNo', 'createdAt', 'updatedAt'],
    order: [[SORTABLE[sortBy], direction], ['id', 'ASC']],
    limit,
    offset,
  });

  const cases = rows.map((row) => ({
    id: row.id,
    currentStatus: row.currentStatus,
    source: row.source,
    claimNo: row.claimNo,
    tpaCaseNumber: row.tpaCaseNumber,
    recognizedType: row.recognizedType,
    createdAt: row.createdAt,
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
  // Case-level documents (API cases' console images); email cases have none.
  const documents = await CaseDocument.findAll({
    where: { caseId: caseRecord.id },
    attributes: { exclude: ['storageRef'] },
    order: [['barcodeId', 'ASC'], ['originalFilename', 'ASC']],
  });

  // assessmentSummary: the explanation trail (what was decided, why, how sure) — built at read time
  // from the same case fields the page shows, so it is always current.
  if (caseRecord.source !== 'API') {
    return res.json({ case: caseRecord, events, documents, assessmentSummary: buildAssessmentSummary(caseRecord) });
  }

  // API cases: their job data lives in ulink_api_case_steps. Fill the same case fields the page
  // reads from each job's latest output, and return every step (input/output/error) for the
  // page's Job Steps section. Email cases take the branch above, unchanged.
  const apiSteps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const fields = { ...caseRecord.toJSON(), ...apiCaseView(apiSteps) };
  res.json({ case: fields, events, documents, apiSteps, assessmentSummary: buildAssessmentSummary(fields) });
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
 * GET /api/cases/:caseId/documents/:documentId — streams one case document (e.g. an API case's
 * console image). Same rules as getAttachment: no auth (Day 1), so the document must belong to
 * :caseId, checked in the query itself.
 */
async function getDocument(req, res) {
  const { caseId, documentId } = req.params;
  const document = await CaseDocument.findOne({ where: { id: documentId, caseId } });
  if (!document) {
    return res.status(404).json({ error: { message: `Document ${documentId} not found on case ${caseId}`, status: 404 } });
  }

  const bytes = await getStorageAdapter().get(document.storageRef);
  const inline = /^application\/pdf$|^image\//.test(document.contentType || '');
  res.set('Content-Type', document.contentType || 'application/octet-stream');
  // originalFilename is already restricted to [A-Za-z0-9._-] when the document is stored.
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${document.originalFilename}"`);
  res.send(bytes);
}

/**
 * POST /api/cases/:id/override — human-in-the-loop bypass for a case stuck at INCOMPLETE or
 * MEMBER_REVIEW_REQUIRED. Advances Case.currentStatus straight to the next stage's own input
 * status — a pure status write, so the next scheduled job picks it up with no special
 * handling. Requires a written reason; who did it is the logged-in console user (req.user,
 * modules/auth/auth.js — replaced the free-text operatorName on 2026-09-28). The user, the reason
 * and a snapshot of exactly what was being waived go into one CaseEvent, so the audit record is
 * self-contained without needing to cross-reference the case's prior state.
 */
async function overrideCase(req, res) {
  const { reason } = req.body || {};
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;

  if (typeof reason !== 'string' || reason.trim() === '') {
    return res.status(400).json({ error: { message: '"reason" is required', status: 400 } });
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
    message: `Overridden by ${operator}: ${reason.trim()}${waived ? ` (waived: ${waived})` : ''}`,
  });

  logger.info('Case manually overridden', { caseId: caseRecord.id, prevStatus, targetStatus, username: req.user.username });

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
    const result = await resetOneCase(req.params.id, 'READY_FOR_DOCUMENT_READING', { source: `console by ${req.user.username}` });
    logger.info('Case manually reset', { caseId: result.caseId, previousStatus: result.previousStatus, username: req.user.username });
    res.json(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: { message: error.message, status: 404 } });
    }
    // Only remaining failure mode is the claimNo guard — a real, already-created IAS claim.
    res.status(409).json({ error: { message: error.message, status: 409 } });
  }
}

module.exports = { getCaseStatuses, getOverview, getReviewQueue, getApprovals, listCases, getCase, getAttachment, getDocument, overrideCase, resetCase, OVERRIDE_TARGETS, REVIEWABLE_STATUSES };
