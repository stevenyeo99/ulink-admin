// A reviewer's own checklist lines on one case (SYSTEM_4 E4-28, owner 2026-10-16): what a person asks for that the
// predefined checklist does not cover — e.g. "Need to fill treatment date in the eye test record". This case only.
//
// Rules:
//   - The AI cannot check a free line. While a line is open, a document check that passes stops for a person
//     (DOCUMENTS_UNSURE / API_DOCUMENTS_UNSURE, whatever switch #3 says); the person's confirm there marks them done.
//   - The lines are one checklist line, PERSON_REQUEST, on the document check result — so the case page, team emails
//     and the IAS remark show them (assessment-summary). Never an issue: the customer's missing-documents email lists
//     only the AI's own items (API cases: never the lines; email cases: until ULINK answers Q23).
//   - Lines are added and closed one by one (E4-29): closed as done (the documents arrived), removed (no longer
//     needed) or reset; an unchanged line keeps its author and date. After every change the copy on the check result
//     is refreshed (refreshRequestLine), so the case page, emails and IAS remark never show a closed line.

const { Op } = require('sequelize');
const { Case, ApiCaseStep, CaseRequest } = require('../../db/models');

// Where a person can ask (the documents review statuses) and where the case goes: the flow's waiting-for-documents
// path. API: the IAS revision with suspense. A case the AI passes surely does not stop for a person (switch #3 does).
const REQUEST_FROM = {
  DOCUMENTS_REVIEW: 'INCOMPLETE',
  DOCUMENTS_UNSURE: 'INCOMPLETE',
  API_DOCUMENTS_REVIEW: 'API_INCOMPLETE',
  API_DOCUMENTS_UNSURE: 'API_INCOMPLETE',
};

const MAX_LINES = 10;
const MAX_CHARS = 300;
const CODE = 'PERSON_REQUEST';

// The lines from a request body, or { error }. allowEmpty: a change that only removes lines.
function validateLines(lines, { allowEmpty = false } = {}) {
  const clean = (Array.isArray(lines) ? lines : [])
    .map((l) => (typeof l === 'string' ? l.trim() : ''))
    .filter(Boolean);
  if (!clean.length && !allowEmpty) return { error: 'Write at least one line: what the customer must send or fix.' };
  if (clean.length > MAX_LINES) return { error: `At most ${MAX_LINES} lines.` };
  if (clean.some((l) => l.length > MAX_CHARS)) return { error: `Each line at most ${MAX_CHARS} characters.` };
  return { lines: [...new Set(clean)] };
}

const openRequests = (caseId, transaction) => CaseRequest.findAll({ where: { caseId, doneAt: null }, order: [['createdAt', 'ASC']], transaction });

const shownRequest = (r) => ({ id: r.id, text: r.text, by: r.createdBy, at: r.createdAt });

// The PERSON_REQUEST checklist line for the open requests, or null when there are none.
function requestLine(open) {
  if (!open.length) return null;
  const requests = open.map(shownRequest);
  return {
    code: CODE,
    label: 'Requested by a person',
    passed: false,
    requests,
    note: requests.map((r) => `${r.text} (asked by ${r.by})`).join('; '),
  };
}

// The check result with the open requests as its PERSON_REQUEST line (any earlier one replaced).
function withRequests(result, open) {
  const line = requestLine(open);
  const checklist = (result.checklist || []).filter((item) => item.code !== CODE);
  return { ...result, checklist: line ? [...checklist, line] : checklist };
}

// The open lines on a check result (its PERSON_REQUEST line), passed or not.
function requestedLines(result) {
  const line = (result?.checklist || []).find((item) => item.code === CODE);
  return line ? line.requests.map((r) => r.text) : [];
}

// The open lines that hold a passed check for a person.
const requestHold = (result) => (result.passed ? requestedLines(result) : []);

// The team email's dedupe key for a request: the lines and the AI's missing items — one key wherever the email is
// built (request, email-flow check, API suspended revision), so the same list is sent once.
const requestedDedupeKey = (lines, issues) => `requested|${lines.join('|')}|${[...issues].sort().join('|')}`;

// Close open lines of a case: ids = those lines (null = every open line). as: done / removed / reset.
// Returns how many closed.
async function closeRequests(caseId, { ids = null, as, by }, transaction) {
  const where = { caseId, doneAt: null, ...(ids ? { id: { [Op.in]: ids } } : {}) };
  const [count] = await CaseRequest.update({ doneBy: by, doneAt: new Date(), closedAs: as }, { where, transaction });
  return count;
}

// The copy of the open lines on the case's latest document check result, brought up to date. Email case: on the case
// row. API case: a document-check step that repeats the latest one with the new line (email null — nothing is sent;
// input.reviewerChecklist marks it as this copy, not a check).
async function refreshRequestLine(caseRecord, transaction) {
  const open = await openRequests(caseRecord.id, transaction);
  if (caseRecord.source !== 'API') {
    const row = await Case.findByPk(caseRecord.id, { attributes: ['id', 'documentCheckResult'], transaction });
    if (row?.documentCheckResult) await Case.update({ documentCheckResult: withRequests(row.documentCheckResult, open) }, { where: { id: caseRecord.id }, transaction });
    return;
  }
  const last = await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'api-document-checking', status: 'DONE' }, order: [['createdAt', 'DESC']], transaction });
  if (!last?.output?.documentCheckResult) return;
  const now = new Date();
  await ApiCaseStep.create({
    caseId: caseRecord.id, job: 'api-document-checking', status: 'DONE', input: { reviewerChecklist: true },
    output: { ...last.output, documentCheckResult: withRequests(last.output.documentCheckResult, open), email: null },
    startedAt: now, finishedAt: now,
  }, { transaction });
}

// For the case page: whether a request can be made now, and the open lines (the form starts from them).
async function requestsInfo(caseRecord) {
  const open = await openRequests(caseRecord.id);
  // Not while the review lane checks the case again after a decision (SYSTEM_5).
  return { allowed: Boolean(REQUEST_FROM[caseRecord.currentStatus]) && !caseRecord.reviewPendingAt, open: open.map(shownRequest) };
}

module.exports = { REQUEST_FROM, requestsInfo, closeRequests, refreshRequestLine, CODE, MAX_LINES, MAX_CHARS, validateLines, openRequests, requestLine, withRequests, requestedLines, requestHold, requestedDedupeKey };
