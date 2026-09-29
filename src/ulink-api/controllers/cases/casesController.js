const { Op, fn, col, cast, where: sqlWhere, literal } = require('sequelize');
const { sequelize, Case, CaseEvent, CaseDocument, ApiCaseStep, EmailThread, EmailMessage, EmailAttachment } = require('../../db/models');
const { OVERRIDE_TARGETS, OVERRIDE_FINDINGS, overrideCheck, overridesFromEvents } = require('../../modules/case-override/override');
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
const { releaseMissingDocumentsEmail } = require('../../modules/document-checking/service');

const BLOCK_NAME = 'case-review';

// Statuses a reviewer can override (which, where to, and why: modules/case-override/override.js).
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
 * GET /api/cases/approvals — non-STP claims waiting for JD3 to approve in IAS, oldest first, each with
 * its AI assessment's review points (what JD3 should look at before approving). Email cases: created
 * in IAS and not STP; API cases: revised in IAS with documents complete (API STP goes on to the CSR
 * instead). The system can't see JD3's approval in IAS, so a case stays here until something moves it.
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
  // Checks a person already overrode, per case (from the override's case-history entry, email and API alike).
  const overrideEvents = cases.length
    ? await CaseEvent.findAll({
      where: { caseId: cases.map((c) => c.id), reasonCode: 'MANUAL_OVERRIDE' },
      attributes: ['caseId', 'prevStatus', 'reasonCode', 'message', 'createdAt'],
    })
    : [];
  const overridesOf = (caseId) => overridesFromEvents(overrideEvents.filter((e) => e.caseId === caseId));

  const items = [];
  for (const c of cases) {
    const entry = queueEntry(c.currentStatus, fieldsOf(c), overridesOf(c.id));
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
  // from the same case fields the page shows, so it is always current. override: whether a
  // reviewer can let this case past its check, and if not, why (modules/case-override/override.js).
  const reviewInfo = (fields) => ({
    assessmentSummary: buildAssessmentSummary(fields, { overrides: overridesFromEvents(events) }),
    override: { ...overrideCheck(fields.currentStatus, fields), findings: OVERRIDE_FINDINGS },
  });
  if (caseRecord.source !== 'API') {
    return res.json({ case: caseRecord, events, documents, ...reviewInfo(caseRecord) });
  }

  // API cases: their job data lives in ulink_api_case_steps. Fill the same case fields the page
  // reads from each job's latest output, and return every step (input/output/error) for the
  // page's Job Steps section. Email cases take the branch above, unchanged.
  const apiSteps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const fields = { ...caseRecord.toJSON(), ...apiCaseView(apiSteps) };
  res.json({ case: fields, events, documents, apiSteps, ...reviewInfo(fields) });
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
 * POST /api/cases/:id/override — { reason, finding }: a reviewer lets a case past a check the AI
 * flagged wrongly (modules/case-override/override.js has which statuses and why). Only the status
 * moves, to what the check would have set on a pass, so the next job picks the case up as usual.
 * Who did it is the logged-in user. The user, the finding (why the check was wrong), the reason and
 * the review points being waived go into one CaseEvent — and, for an API case, a `case-override`
 * step in its job history — so the audit record stands on its own.
 */
async function overrideCase(req, res) {
  const { reason, finding } = req.body || {};
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;

  if (typeof reason !== 'string' || reason.trim() === '') {
    return res.status(400).json({ error: { message: 'Write a reason for the override.', status: 400 } });
  }
  if (!OVERRIDE_FINDINGS[finding]) {
    return res.status(400).json({ error: { message: `Pick why the check was wrong: ${Object.keys(OVERRIDE_FINDINGS).join(', ')}`, status: 400 } });
  }

  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) {
    return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  }
  const fields = caseRecord.source === 'API'
    ? apiCaseView(await ApiCaseStep.findAll({ where: { caseId: caseRecord.id } }))
    : caseRecord;
  const check = overrideCheck(caseRecord.currentStatus, fields);
  if (!check.allowed) {
    return res.status(400).json({
      error: { message: check.reason || `This case is at "${caseRecord.currentStatus}", which can't be overridden.`, status: 400 },
    });
  }

  const prevStatus = caseRecord.currentStatus;
  const targetStatus = check.target;
  const waived = buildAssessmentSummary(fields).reviewPoints.map((p) => `${p.decision}: ${p.reason}`);
  const now = new Date();

  const moved = await sequelize.transaction(async (transaction) => {
    // Only if nothing moved the case meanwhile (e.g. a re-check just passed it).
    const [count] = await Case.update(
      { currentStatus: targetStatus },
      { where: { id: caseRecord.id, currentStatus: prevStatus }, transaction }
    );
    if (count !== 1) return false;
    await CaseEvent.create({
      caseId: caseRecord.id,
      blockName: BLOCK_NAME,
      prevStatus,
      newStatus: targetStatus,
      reasonCode: 'MANUAL_OVERRIDE',
      message: `Overridden by ${operator} — ${OVERRIDE_FINDINGS[finding]}: ${reason.trim()}`
        + (waived.length ? ` (waived: ${waived.join('; ')})` : ''),
    }, { transaction });
    if (caseRecord.source === 'API') {
      await ApiCaseStep.create({
        caseId: caseRecord.id,
        job: 'case-override',
        status: 'DONE',
        input: { username: req.user.username, finding, reason: reason.trim() },
        // note: the same text as the case-history entry — later API jobs read it (e.g. the JD3 email).
        output: { from: prevStatus, to: targetStatus, waived, note: `Overridden by ${operator} — ${OVERRIDE_FINDINGS[finding]}: ${reason.trim()}` },
        startedAt: now,
        finishedAt: now,
      }, { transaction });
    }
    return true;
  });
  if (!moved) {
    return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  }

  logger.info('Case manually overridden', { caseId: caseRecord.id, prevStatus, targetStatus, finding, username: req.user.username });
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

/**
 * POST /api/cases/:id/release-missing-documents — a held case (switch "hold the missing-documents email
 * when the AI is unsure"): a person checked the documents and they really are missing, so the customer
 * gets the request the document check prepared. Email case: → INCOMPLETE. API case: → API_INCOMPLETE
 * (then the usual suspended revision in IAS); the email goes out through api-email-sender as a
 * case-review step. The other choice — the documents are fine — is the normal override.
 */
async function releaseMissingDocuments(req, res) {
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const notHeld = () => res.status(400).json({ error: { message: 'This case is not waiting for a check before the customer is emailed.', status: 400 } });

  if (caseRecord.source !== 'API') {
    if (caseRecord.currentStatus !== 'DOCUMENTS_REVIEW') return notHeld();
    if (!(await releaseMissingDocumentsEmail(caseRecord, operator))) {
      return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
    }
    logger.info('Missing-documents email released', { caseId: caseRecord.id, username: req.user.username });
    return res.json({ caseId: caseRecord.id, currentStatus: 'INCOMPLETE' });
  }

  if (caseRecord.currentStatus !== 'API_DOCUMENTS_REVIEW') return notHeld();
  const check = await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'api-document-checking', status: 'DONE' }, order: [['createdAt', 'DESC']] });
  const heldEmail = check?.output?.heldEmail;
  if (!heldEmail) return res.status(409).json({ error: { message: 'No held email found for this case.', status: 409 } });
  const now = new Date();
  const moved = await sequelize.transaction(async (transaction) => {
    const [count] = await Case.update({ currentStatus: 'API_INCOMPLETE' }, { where: { id: caseRecord.id, currentStatus: 'API_DOCUMENTS_REVIEW' }, transaction });
    if (count !== 1) return false;
    await CaseEvent.create({ caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: 'API_DOCUMENTS_REVIEW', newStatus: 'API_INCOMPLETE', reasonCode: 'MISSING_DOCUMENTS_RELEASED', message: `Missing-documents email sent to the customer by ${operator} after review` }, { transaction });
    await ApiCaseStep.create({ caseId: caseRecord.id, job: 'case-review', status: 'DONE', input: { username: req.user.username, action: 'release-missing-documents' }, output: { email: heldEmail }, startedAt: now, finishedAt: now }, { transaction });
    return true;
  });
  if (!moved) return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  logger.info('Missing-documents email released', { caseId: caseRecord.id, username: req.user.username });
  res.json({ caseId: caseRecord.id, currentStatus: 'API_INCOMPLETE' });
}

module.exports = { getCaseStatuses, getOverview, getReviewQueue, getApprovals, listCases, getCase, getAttachment, getDocument, overrideCase, resetCase, releaseMissingDocuments, OVERRIDE_TARGETS, REVIEWABLE_STATUSES };
