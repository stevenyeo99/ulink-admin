// The case detail page reads its sections from case fields (extractedFields, memberVerifyResult,
// documentCheckResult, ...). Email jobs write those onto ulink_cases; API jobs keep their data in
// ulink_api_case_steps instead (single source, D12). This maps each API job's latest DONE output
// onto the same field names at read time, so every existing section of the page works for API
// cases too — nothing is written back to ulink_cases.
//
// One line per field; a new API job whose output a page section should show adds one line here.
const FIELDS = {
  recognizedType: ['api-claim-recognition', (o) => o.recognizedType],
  extractedFields: ['api-claim-recognition', (o) => o.extractedFields],
  memberVerifyResult: ['api-member-verification', (o) => o.memberVerifyResult],
  iasMemberInfoResponse: ['api-member-verification', (o) => o.iasMemberInfoResponse],
  documentCheckResult: ['api-document-checking', (o) => o.documentCheckResult],
  iasClaimPayload: ['api-claim-preparation', (o) => o.payload],
  claimPrepMeta: ['api-claim-preparation', (o) => o.claimPrepMeta],
  isStp: ['api-claim-preparation', (o) => o.isStp],
  iasClaimResult: ['api-claim-revision', (o) => o.response],
};

// steps: the case's ApiCaseStep rows (any order). Returns only the fields some job has produced.
function apiCaseView(steps) {
  const latestDone = new Map();
  for (const step of [...steps].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (step.status === 'DONE' && step.output) latestDone.set(step.job, step.output);
  }
  const view = {};
  for (const [field, [job, pick]] of Object.entries(FIELDS)) {
    const output = latestDone.get(job);
    const value = output && pick(output);
    if (value !== undefined) view[field] = value;
  }
  return view;
}

module.exports = { apiCaseView };
