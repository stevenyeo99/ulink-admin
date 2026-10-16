// Email draft (SYSTEM_4 E4-29): the customer missing-documents email as it would read now — the approved template with
// the open system checklist items (the AI and the rules) and the reviewer checklist lines — for staff to copy and send
// themselves. Never sent by the system (API cases: owner's rule; email cases: until ULINK answers Q23).

const { CaseEvent, ApiCaseStep } = require('../../db/models');
const { overridesFromEvents } = require('../case-override/override');
const { missingDocumentItems } = require('../document-checking/service');
const { render } = require('../email-sender/templates');
const { openRequests } = require('./requests');

// The open system items: the check's missing items, none once it passed or a person overrode the document check
// (the same rule the assessment uses for overridden lines).
function systemItems(result, overrides) {
  if (!result || result.passed || overrides.some((o) => o.area === 'documents')) return [];
  return missingDocumentItems(result);
}

/**
 * { system, reviewer, text } for a case. reviewerLines: the lines being edited (null = the open ones saved).
 * text: the email body, or null when there is nothing to ask for.
 */
async function emailDraft(caseRecord, reviewerLines = null) {
  // API: only the latest document check is needed (asked again as the reviewer types), not every step.
  const documentCheckResult = caseRecord.source === 'API'
    ? (await ApiCaseStep.findOne({ where: { caseId: caseRecord.id, job: 'api-document-checking', status: 'DONE' }, order: [['createdAt', 'DESC']] }))?.output?.documentCheckResult
    : caseRecord.documentCheckResult;
  const overrides = overridesFromEvents(await CaseEvent.findAll({ where: { caseId: caseRecord.id, reasonCode: 'MANUAL_OVERRIDE' } }));
  const system = systemItems(documentCheckResult, overrides);
  const reviewer = reviewerLines ?? (await openRequests(caseRecord.id)).map((r) => r.text);
  const items = [...system, ...reviewer];
  return { system, reviewer, text: items.length ? render('MISSING_DOCUMENTS', { issues: items }).bodyText : null };
}

module.exports = { emailDraft, systemItems };
