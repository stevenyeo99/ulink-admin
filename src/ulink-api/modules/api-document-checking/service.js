const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkCase } = require('../document-checking/service');
const { getSettings } = require('../settings/settings');
const { unsureDocumentPoints } = require('../document-checking/holdForReview');
const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { caseBasics } = require('../assessment-summary/journey');

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
  const issues = result.issues.map((issue) => {
    const detail = result.details.find((candidate) => candidate.issue === issue && candidate.reason);
    return detail?.reason ? `${issue}\n  Reason: ${detail.reason}` : issue;
  });
  return { taskType: 'MISSING_DOCUMENTS', audience: 'customer', payload: { issues }, dedupeKey: [...result.issues].sort().join('|') };
}

const OUTCOME_TO_STATUS = {
  DOCUMENT_CHECKED: 'API_DOCUMENTS_VERIFIED',
  INCOMPLETE: 'API_INCOMPLETE',
};

async function processCase({ caseRecord, input }) {
  const { extractedFields, recognizedType } = input['api-claim-recognition'];
  const { outcome, result } = await checkCase({ id: caseRecord.id, extractedFields, recognizedType });
  if (!OUTCOME_TO_STATUS[outcome]) throw new Error(`Unexpected document check outcome: ${outcome}`);

  // Switch "hold the missing-documents email when the AI is unsure" (settings): the case waits for a
  // person (API_DOCUMENTS_REVIEW) instead of going on to a suspended revision; the customer email is kept
  // aside (heldEmail) and sent only if the person confirms (POST /api/cases/:id/release-missing-documents).
  const unsure = result.passed ? [] : unsureDocumentPoints(result);
  if (unsure.length && (await getSettings()).holdUnsureMissingDocsEmail) {
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
        email: { taskType: 'DOCUMENTS_INCOMPLETE', audience: 'internal', payload: { caseId: caseRecord.id, claimNo: caseRecord.claimNo, issues: result.issues, held: unsure, assessment }, dedupeKey: `held|${issuesKey}` },
      },
      nextStatus: 'API_DOCUMENTS_REVIEW',
      message: `Documents incomplete: ${result.issues.join('; ')} — customer email held: the AI was unsure (${unsure.join('; ')})`,
    };
  }

  const nextStatus = OUTCOME_TO_STATUS[outcome];
  return {
    output: {
      outcome,
      documentCheckResult: result,
      // When documents were found complete — claim preparation's docCompleteDate.
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

module.exports = { run: () => runApiJob(job), job };
