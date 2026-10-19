const { Op, fn, col, cast, where: sqlWhere, literal } = require('sequelize');
const { sequelize, Case, CaseEvent, CaseDocument, ApiCaseStep, EmailThread, EmailMessage, EmailAttachment, LlmCall, AiFeedback } = require('../../db/models');
const { buildTimeline } = require('../../modules/case-timeline/timeline');
const { OVERRIDE_TARGETS, OVERRIDE_AREAS, OVERRIDE_FINDINGS, findingsFor, overrideCheck, overridesFromEvents } = require('../../modules/case-override/override');
const { todayInIasTimezone } = require('../../modules/shared/iasDates');
const { apiCaseView } = require('../../modules/api-pipeline/caseView');
const { buildAssessmentSummary } = require('../../modules/assessment-summary/summary');
const { nextAction } = require('../../modules/assessment-summary/nextAction');
const { queueEntry, REASON_ORDER } = require('../../modules/review-queue/queue');
const { CASE_STATUSES, MODULES, GROUPS, codesInGroup, OUTCOMES, outcomeOf } = require('../../modules/case-status/catalog');


// Every status code the jobs set — rejects a typo'd ?status= filter with a helpful error.
const KNOWN_STATUSES = Object.keys(CASE_STATUSES);
const { getStorageAdapter } = require('../../storage');
const { resetOneCase } = require('../dev/casesController');
const logger = require('../../utils/logger');
const { releaseMissingDocumentsEmail } = require('../../modules/document-checking/service');
const { uploadDocuments, UploadRefused } = require('../../modules/case-upload/upload');
const { correctionsInfo } = require('./correctionsController');
const { claimView, activeClaims, endClaim } = require('../../modules/case-claim/claim');
const { workingDaysSince } = require('../../modules/shared/workingDays');
const { lastReadSettings } = require('../../modules/settings/settings');
const { CaseClaim } = require('../../db/models');
const { requestsInfo, closeRequests, refreshRequestLine } = require('../../modules/case-requests/requests');

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

// Who is reviewing each queued case right now (claim: { username, name, … } or null — SYSTEM_4 E4-22).
async function withClaims(items) {
  const claims = await activeClaims(items.map((i) => i.id));
  for (const item of items) item.claim = claims.get(item.id) ?? null;
}

// How long each queued case has waited for a person (SYSTEM_4 E4-19 / E6): working days since it entered its current
// status — the latest case-history entry that moved it there (a claim or a saved correction that doesn't move it
// doesn't reset the clock); its last change when there is none. Overdue past the STP-settings limit (default 2) — only
// for cases a person must act on (needs review), not those waiting for the customer or the pipeline.
// statusEvents: the cases' case-history entries (caseId, prevStatus, newStatus, createdAt), any order.
function withWaiting(items, statusEvents) {
  const { overdueWorkingDays } = lastReadSettings();
  const now = new Date();
  for (const item of items) {
    const entered = statusEvents
      .filter((e) => e.caseId === item.id && e.newStatus === item.currentStatus && e.prevStatus !== e.newStatus)
      .reduce((latest, e) => (!latest || new Date(e.createdAt) > new Date(latest) ? e.createdAt : latest), null);
    item.waitingWorkingDays = workingDaysSince(entered || item.updatedAt, now);
    item.overdue = CASE_STATUSES[item.currentStatus]?.group === 'needs_review'
      && item.waitingWorkingDays != null && item.waitingWorkingDays > overdueWorkingDays;
  }
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
  await withClaims(items);
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
  const items = await reviewQueueItems(source);
  const counts = Object.fromEntries(REASON_ORDER.map((r) => [r, items.filter((i) => i.reason === r).length]));
  res.json({ items, counts, total: items.length });
}

/**
 * GET /api/cases/next?after=<caseId>&source= — the case to review next (the review workspace's "Next case", SYSTEM_4
 * E4-20): the first case after `after` in queue order (oldest first, wrapping round to the start), skipping cases
 * someone else is reviewing — so the reviewer walks down the queue instead of bouncing between the two oldest.
 * `after` no longer in the queue (decided): from the oldest. { id } or { id: null } when nothing else is waiting.
 */
async function getNextCase(req, res) {
  const source = req.query.source ? String(req.query.source).toUpperCase() : null;
  if (source && !CASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: { message: `Unknown source filter: ${req.query.source}. Must be one of: ${CASE_SOURCES.join(', ')}`, status: 400 } });
  }
  const after = req.query.after ? String(req.query.after) : null;
  // ponytail: rebuilds the whole queue (as GET /review-queue does) for one id; stop at the first match once the
  // queue runs into hundreds of open cases.
  const items = await reviewQueueItems(source);
  const at = items.findIndex((i) => i.id === after);
  const ordered = at >= 0 ? [...items.slice(at + 1), ...items.slice(0, at)] : items;
  const next = ordered.find((i) => !i.claim || i.claim.username === req.user.username);
  res.json({ id: next?.id ?? null });
}

// The review queue, oldest first, each with its reason and who is reviewing it (modules/review-queue/queue.js).
async function reviewQueueItems(source) {
  const cases = await Case.findAll({
    where: { currentStatus: QUEUE_CANDIDATE_STATUSES, ...(source ? { source } : {}) },
    order: [['updatedAt', 'ASC']],
    limit: QUEUE_SCAN_LIMIT,
  });

  const fieldsOf = await assessmentFieldsLoader(cases);
  // The cases' history, read once: the checks a person already overrode (email and API alike) and when each case
  // entered its current status (how long it has waited).
  const events = cases.length
    ? await CaseEvent.findAll({
      where: { caseId: cases.map((c) => c.id) },
      attributes: ['caseId', 'prevStatus', 'newStatus', 'reasonCode', 'message', 'createdAt'],
    })
    : [];
  const overrideEvents = events.filter((e) => e.reasonCode === 'MANUAL_OVERRIDE');
  const overridesOf = (caseId) => overridesFromEvents(overrideEvents.filter((e) => e.caseId === caseId));

  const items = [];
  for (const c of cases) {
    const entry = queueEntry(c.currentStatus, fieldsOf(c), overridesOf(c.id));
    if (!entry) continue;
    items.push({ ...listRow(c), ...entry });
  }
  await withClaims(items);
  withWaiting(items, events);
  return items;
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
  res.json({ total, newToday, groups, days: await outcomesByDay(where) });
}

const TREND_DAYS = 14;
// Myanmar date (YYYY-MM-DD) of a time — the day the claim was received, as IAS and the claim intake count days.
const myanmarDay = (date) => todayInIasTimezone(new Date(date));

/**
 * The Overview chart: claims received on each of the last 14 days (Myanmar time), by where they are now (outcomeOf).
 * A day's bar keeps its total; its parts move as claims finish.
 * ponytail: reads one row per case of the 14 days and counts here; a GROUP BY in SQL if daily volume gets large.
 */
async function outcomesByDay(where) {
  const days = Array.from({ length: TREND_DAYS }, (_, i) => myanmarDay(Date.now() - (TREND_DAYS - 1 - i) * 86400000));
  const counts = Object.fromEntries(days.map((day) => [day, Object.fromEntries(OUTCOMES.map((o) => [o, 0]))]));
  const rows = await Case.findAll({
    where: { ...where, createdAt: { [Op.gte]: new Date(`${days[0]}T00:00:00+06:30`) } },
    attributes: ['createdAt', 'currentStatus', 'isStp'],
    raw: true,
  });
  for (const row of rows) {
    const day = counts[myanmarDay(row.createdAt)];
    if (day) day[outcomeOf(row.currentStatus, row.isStp)] += 1;
  }
  return days.map((day) => ({ day, ...counts[day] }));
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
  // case id, and the claimant name and NRC / passport the AI read — on the case row for email
  // cases, in the recognition step for API cases (modules/api-pipeline/caseView.js).
  const q = req.query.q ? String(req.query.q).trim() : '';
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const claimant = (json) => [`${json}->'claimant'->>'claimant_name'`, `${json}->'claimant'->>'claimant_nrc_passport'`];
    const quoted = sequelize.escape(like);
    where[Op.or] = [
      { claimNo: { [Op.iLike]: like } },
      { tpaCaseNumber: { [Op.iLike]: like } },
      sqlWhere(cast(col('Case.id'), 'text'), { [Op.iLike]: like }),
      ...claimant(`"Case"."extracted_fields"`).map((path) => sqlWhere(literal(path), { [Op.iLike]: like })),
      literal(`EXISTS (SELECT 1 FROM ulink_api_case_steps s WHERE s.case_id = "Case"."id" AND s.job = 'api-claim-recognition'`
        + ` AND (${claimant(`s.output->'extractedFields'`).map((path) => `${path} ILIKE ${quoted}`).join(' OR ')}))`),
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
  // nextAction: what has to happen next and who does it, in one sentence — the top of the case page (SYSTEM_4 E4-21).
  const reviewInfo = (fields) => {
    const assessmentSummary = buildAssessmentSummary(fields, { overrides: overridesFromEvents(events) });
    return {
      assessmentSummary,
      nextAction: nextAction(fields, assessmentSummary, events),
      override: { ...overrideCheck(fields.currentStatus, fields), findings: findingsFor(fields.currentStatus) },
    };
  };
  // corrections: per-item corrections allowed now, what can be corrected, and those made (SYSTEM_4 E4-12).
  // claim: who is reviewing the case right now, or null (SYSTEM_4 E4-22).
  const claim = claimView(await CaseClaim.findByPk(caseRecord.id));
  if (caseRecord.source !== 'API') {
    return res.json({ case: caseRecord, events, documents, ...reviewInfo(caseRecord), corrections: await correctionsInfo(caseRecord, caseRecord), requests: await requestsInfo(caseRecord), claim });
  }

  // API cases: their job data lives in ulink_api_case_steps. Fill the same case fields the page
  // reads from each job's latest output, and return every step (input/output/error) for the
  // page's Job Steps section. Email cases take the branch above, unchanged.
  const apiSteps = await ApiCaseStep.findAll({ where: { caseId: caseRecord.id }, order: [['createdAt', 'ASC']] });
  const fields = { ...caseRecord.toJSON(), ...apiCaseView(apiSteps) };
  res.json({ case: fields, events, documents, apiSteps, ...reviewInfo(fields), corrections: await correctionsInfo(caseRecord, fields), requests: await requestsInfo(caseRecord), claim });
}

/**
 * GET /api/cases/:id/timeline — the case's single timeline, newest first (SYSTEM_4 E4-24): case history, AI calls (grouped
 * per job run, no raw answers), "✓ Right" confirmations and trusted marks. modules/case-timeline/timeline.js.
 */
async function getTimeline(req, res, next) {
  try {
    const caseId = req.params.id;
    if (!UUID.test(caseId) || !(await Case.findByPk(caseId, { attributes: ['id'] }))) {
      return res.status(404).json({ error: { message: `Case ${caseId} not found`, status: 404 } });
    }
    // Oldest first, ties by id (the builder keeps that order for entries with the same time).
    const oldestFirst = [['createdAt', 'ASC'], ['id', 'ASC']];
    const [events, newestCalls, feedback] = await Promise.all([
      CaseEvent.findAll({ where: { caseId }, attributes: ['id', 'blockName', 'prevStatus', 'newStatus', 'reasonCode', 'message', 'createdAt'], order: oldestFirst }),
      // The newest 2000 AI calls (a case re-read many times can have more).
      LlmCall.findAll({ where: { caseId }, attributes: ['id', 'job', 'promptName', 'status', 'durationMs', 'createdAt'], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 2000 }),
      AiFeedback.findAll({ where: { caseId }, attributes: ['id', 'kind', 'label', 'aiValue', 'reason', 'createdBy', 'trusted', 'trustedBy', 'trustedAt', 'createdAt'], order: oldestFirst }),
    ]);
    return res.json({ entries: buildTimeline({ events, llmCalls: [...newestCalls].reverse(), feedback }) });
  } catch (error) {
    return next(error);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cases/:id/llm-calls — every AI call made for this case, oldest first (SYSTEM_4 E4-26, modules/llm-calls):
 * which job and prompt version, how it went, and what the AI answered. For the case page's technical details.
 */
async function getLlmCalls(req, res) {
  const calls = await LlmCall.findAll({ where: { caseId: req.params.id }, order: [['createdAt', 'ASC']], limit: 500 });
  res.json({ calls });
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
  if (check.allowed && !findingsFor(caseRecord.currentStatus)[finding]) {
    return res.status(400).json({ error: { message: `Pick one of: ${Object.keys(findingsFor(caseRecord.currentStatus)).join(', ')}`, status: 400 } });
  }
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
    // A person confirmed the documents: the reviewer checklist's open lines are done too (SYSTEM_4 E4-28 / E4-29).
    if (OVERRIDE_AREAS[prevStatus] === 'documents' && await closeRequests(caseRecord.id, { as: 'done', by: operator }, transaction)) {
      await refreshRequestLine(caseRecord, transaction);
    }
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

  await endClaim(caseRecord.id, req.user.username); // the holder decided the case — their own claim ends (SYSTEM_4 E4-22)
  logger.info('Case manually overridden', { caseId: caseRecord.id, prevStatus, targetStatus, finding, username: req.user.username });
  res.json({ caseId: caseRecord.id, previousStatus: prevStatus, currentStatus: targetStatus });
}

// Every manual action on a case says why (SYSTEM_4 E4-11) — the comment goes into the case history. Answers 400 and
// returns null when it is missing or too short; why: what the comment should explain.
function requiredComment(req, res, why) {
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (comment.length >= 3) return comment;
  res.status(400).json({ error: { message: `Add a comment: why ${why}.`, status: 400 } });
  return null;
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
  const comment = requiredComment(req, res, 'you reset this case');
  if (comment === null) return undefined;
  try {
    const result = await resetOneCase(req.params.id, 'READY_FOR_DOCUMENT_READING', { source: `console by ${req.user.username}`, comment });
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
  const comment = requiredComment(req, res, 'the documents really are missing');
  if (comment === null) return undefined;
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const notHeld = () => res.status(400).json({ error: { message: 'This case is not waiting for a check before the customer is emailed.', status: 400 } });

  if (caseRecord.source !== 'API') {
    if (caseRecord.currentStatus !== 'DOCUMENTS_REVIEW') return notHeld();
    if (!(await releaseMissingDocumentsEmail(caseRecord, operator, comment))) {
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
    await CaseEvent.create({ caseId: caseRecord.id, blockName: BLOCK_NAME, prevStatus: 'API_DOCUMENTS_REVIEW', newStatus: 'API_INCOMPLETE', reasonCode: 'MISSING_DOCUMENTS_RELEASED', message: `Missing-documents email sent to the customer by ${operator} after review — comment: ${comment}` }, { transaction });
    await ApiCaseStep.create({ caseId: caseRecord.id, job: 'case-review', status: 'DONE', input: { username: req.user.username, action: 'release-missing-documents', comment }, output: { email: heldEmail }, startedAt: now, finishedAt: now }, { transaction });
    return true;
  });
  if (!moved) return res.status(409).json({ error: { message: 'The case changed while you were reviewing it. Reload the page and check again.', status: 409 } });
  logger.info('Missing-documents email released', { caseId: caseRecord.id, username: req.user.username });
  res.json({ caseId: caseRecord.id, currentStatus: 'API_INCOMPLETE' });
}

/**
 * POST /api/cases/:id/documents — upload missing documents for an API case waiting on them
 * (modules/case-upload/upload.js, SYSTEM_4 E4-04). Body: { comment, files: [{ filename, contentType, data (base64) }] }.
 * Any logged-in user. The case is read and checked again at once (API_UPLOAD_RECEIVED); the documents go to the IAS
 * console after the document check.
 */
async function uploadCaseDocuments(req, res) {
  const comment = requiredComment(req, res, 'you are uploading these documents');
  if (comment === null) return undefined;
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).map((f) => ({
    filename: typeof f?.filename === 'string' ? f.filename : null,
    contentType: typeof f?.contentType === 'string' ? f.contentType : null,
    bytes: Buffer.from(typeof f?.data === 'string' ? f.data : '', 'base64'),
  }));
  const caseRecord = await Case.findByPk(req.params.id);
  if (!caseRecord) return res.status(404).json({ error: { message: `Case ${req.params.id} not found`, status: 404 } });
  const operator = req.user.name ? `${req.user.name} (${req.user.username})` : req.user.username;
  try {
    const result = await uploadDocuments(caseRecord, files, { operator, username: req.user.username, comment });
    logger.info('Documents uploaded on the case page', { caseId: caseRecord.id, files: result.files, username: req.user.username });
    return res.json({ caseId: caseRecord.id, currentStatus: result.status, files: result.files });
  } catch (error) {
    if (error instanceof UploadRefused) return res.status(error.status).json({ error: { message: error.message, status: error.status } });
    logger.error('Case upload failed', { caseId: caseRecord.id, error: error.message });
    return res.status(502).json({ error: { message: `The upload didn't go through (${error.message}). Nothing changed — try again.`, status: 502 } });
  }
}

module.exports = { requiredComment, getCaseStatuses, getOverview, getReviewQueue, getNextCase, getApprovals, listCases, getCase, getTimeline, getLlmCalls, getAttachment, getDocument, overrideCase, resetCase, releaseMissingDocuments, uploadCaseDocuments, OVERRIDE_TARGETS, REVIEWABLE_STATUSES };
