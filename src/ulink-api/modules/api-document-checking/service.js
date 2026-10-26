const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase, missingDocumentItems } = require('../document-checking/service');
const { getSettings } = require('../settings/settings');
const { unsureDocumentPoints, unsurePassedPoints } = require('../document-checking/holdForReview');
const { correctionHold } = require('../ai-feedback/corrections');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { caseBasics } = require('../assessment-summary/journey');
const { openRequests, withRequests, requestHold } = require('../case-requests/requests');

// api-document-checking: API case workflow job 5 (docs/imp/day1/api-case-workflow.md section 6.5).
//
//   input:  { 'api-claim-recognition': { recognizedType, extractedFields, ... } }
//   output: { outcome, documentCheckResult, email }
//
// The email flow's own document check, unchanged: document-checking's checkCase runs the whole
// checklist plus its entity-match judgments on the extracted fields. Runs after the member check
// (API_READY_FOR_DOCUMENT_CHECKING), same order as email. Its input is the OCR output, not the
// member check's: the checklist only needs the extracted fields.

// The customer email the email flow sends for each outcome, with the same payload and dedupe key
// (document-checking's queueMissingDocumentsEmail / queueCompleteAckEmail). Sent by api-email-sender.
function emailFor(result) {
  // Complete documents send nothing: the customer was acknowledged at api-claim-recognition.
  if (result.passed) return null;
  return { taskType: 'MISSING_DOCUMENTS', audience: 'customer', payload: { issues: missingDocumentItems(result) }, dedupeKey: [...result.issues].sort().join('|') };
}

const OUTCOME_TO_STATUS = {
  DOCUMENT_CHECKED: 'API_DOCUMENTS_VERIFIED',
  INCOMPLETE: 'API_INCOMPLETE',
};

async function processCase({ caseRecord, input }) {
  const { extractedFields, recognizedType } = input['api-claim-recognition'];
  const checked = await checkCase({ id: caseRecord.id, extractedFields, recognizedType });
  const { outcome } = checked;
  // A reviewer's own lines (SYSTEM_4 E4-28) go on the result; open ones hold a pass for a person whatever the switch.
  const result = withRequests(checked.result, await openRequests(caseRecord.id));
  const requested = requestHold(result);
  if (!OUTCOME_TO_STATUS[outcome]) throw new Error(`Unexpected document check outcome: ${outcome}`);

  // Switch "hold the missing-documents email when the AI is unsure" (settings): the case waits for a
  // person (API_DOCUMENTS_REVIEW) instead of going on to a suspended revision; the customer email is kept
  // aside (heldEmail) and sent only if the person confirms (POST /api/cases/:id/release-missing-documents).
  // After a person corrected items (SYSTEM_4 E4-12): held for them whatever the switch — they send the request.
  const unsure = [
    ...(result.passed || !(await getSettings()).holdUnsureMissingDocsEmail ? [] : unsureDocumentPoints(result)),
    ...correctionHold(result, extractedFields),
  ];
  if (unsure.length) {
    const issuesKey = [...result.issues].sort().join('|');
    const assessment = assessmentSummaryText(buildAssessmentSummary({
      ...caseBasics(caseRecord), recognizedType, currentStatus: 'API_DOCUMENTS_REVIEW', documentCheckResult: result,
      memberVerifyResult: input['api-member-verification']?.memberVerifyResult,
    }));
    return {
      output: {
        outcome,
        documentCheckResult: result,
        checkedAt: new Date().toISOString(),
        heldEmail: emailFor(result),
        email: { taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { caseId: caseRecord.id, claimNo: caseRecord.claimNo, issues: result.issues, held: unsure, contactCustomer: !(await getSettings()).apiSendMissingDocumentsEmail, assessment }, dedupeKey: `held|${issuesKey}` },
      },
      nextStatus: 'API_DOCUMENTS_REVIEW',
      message: `Documents incomplete: ${result.issues.join('; ')} — customer email held for a person: ${unsure.join('; ')}`,
    };
  }

  // Passed, but the AI was unsure about an item (settings.holdUnsureDocumentPass, SYSTEM_4 E4-09): a person confirms
  // (API_DOCUMENTS_UNSURE) before the IAS revision; confirmed, it continues as documents complete.
  const unsurePassed = result.passed ? unsurePassedPoints(result) : [];
  if (requested.length || (unsurePassed.length && (await getSettings()).holdUnsureDocumentPass)) {
    return {
      output: { outcome, documentCheckResult: result, checkedAt: new Date().toISOString(), email: null },
      nextStatus: 'API_DOCUMENTS_UNSURE',
      message: requested.length
        ? `Documents complete — a person checks the requested lines first: ${requested.join('; ')}`
        : `Documents complete — a person confirms first: the AI was unsure about ${unsurePassed.join('; ')}`,
    };
  }

  const nextStatus = OUTCOME_TO_STATUS[outcome];
  return {
    output: {
      outcome,
      documentCheckResult: result,
      // When the documents were checked (kept for the record; claim preparation sends its own date to IAS).
      checkedAt: new Date().toISOString(),
      email: emailFor(result),
    },
    nextStatus,
    message: result.passed ? 'Documents complete' : `Documents incomplete: ${result.issues.join('; ')}`,
  };
}

const job = {
  name: 'api-document-checking',
  inputStatus: 'API_READY_FOR_DOCUMENT_CHECKING',
  inputs: ['api-claim-recognition'],
  optionalInputs: ['api-member-verification'],
  batchLimit: config.documentChecking.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job, emailFor };
