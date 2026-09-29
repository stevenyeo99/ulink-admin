const { buildAssessmentSummary, assessmentSummaryText } = require('../assessment-summary/summary');
const { caseBasics } = require('../assessment-summary/journey');
const { OVERRIDE_AREAS } = require('../case-override/override');

// An API case's AI assessment text (with "why the case went this way") from a job's inputs — the
// earlier jobs' outputs — for its internal emails and audit snapshot (api-claim-revision, api-claim-stp).
// Same case fields the email flow keeps on ulink_cases, taken from this case's earlier job outputs.
// now: where this step leaves the case (status, IAS answer), so the journey ends there.
function assessmentFor(input, caseRecord, now) {
  const prepared = input['api-claim-preparation'];
  // A reviewer's override (the case's latest case-override step) marks that check's points as handled.
  const override = input['case-override'];
  const overrides = override && OVERRIDE_AREAS[override.from] ? [{ area: OVERRIDE_AREAS[override.from], at: null, note: override.note }] : [];
  return assessmentSummaryText(buildAssessmentSummary({
    ...caseBasics(caseRecord),
    recognizedType: input['api-claim-recognition']?.recognizedType ?? caseRecord.recognizedType,
    claimNo: prepared.payload.claimNo,
    ...now,
    memberVerifyResult: input['api-member-verification']?.memberVerifyResult,
    documentCheckResult: input['api-document-checking']?.documentCheckResult,
    claimPrepMeta: prepared.claimPrepMeta,
    isStp: prepared.isStp,
  }, { overrides }));
}

module.exports = { assessmentFor };
