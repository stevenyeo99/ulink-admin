// The case detail page reads its sections from case fields (extractedFields, memberVerifyResult,
// documentCheckResult, ...). Email jobs write those onto ulink_cases; API jobs keep their data in
// ulink_api_case_steps instead (single source, D12). This maps each API job's latest DONE output
// onto the same field names at read time, so every existing section of the page works for API
// cases too — nothing is written back to ulink_cases.
//
const { choiceFor, sameDiagnosis, diagnosisSource } = require('../ias-claim-preparation/preparationReview');
const { uniqueBenefitCandidates } = require('../shared/iasBenefits');

// One line per field; a new API job whose output a page section should show adds one line here.
const FIELDS = {
  recognizedType: ['api-claim-recognition', (o) => o.recognizedType],
  extractedFields: ['api-claim-recognition', (o) => o.extractedFields],
  memberVerifyResult: ['api-member-verification', (o) => o.memberVerifyResult],
  iasMemberInfoResponse: ['api-member-verification', (o) => o.iasMemberInfoResponse],
  documentCheckResult: ['api-document-checking', (o) => o.documentCheckResult],
  // Why the document check waits for a person before the customer request (API_DOCUMENTS_REVIEW).
  documentsHeldFor: ['api-document-checking', (o) => o.email?.payload?.held],
  // The claim preparation preview at the document stop (API_DOCUMENTS_REVIEW / API_DOCUMENTS_UNSURE, UAT 17/11).
  preparationPreview: ['api-document-checking', (o) => o.preparationPreview],
  iasClaimPayload: ['api-claim-preparation', (o) => o.payload],
  claimPrepMeta: ['api-claim-preparation', (o) => o.claimPrepMeta],
  isStp: ['api-claim-preparation', (o) => o.isStp],
  iasClaimResult: ['api-claim-revision', (o) => o.response],
};

// A case sent back before claim preparation (a correction, an upload, new console documents) keeps its old claim
// preparation and revision steps. They describe the last pass, not the case now, so they are shown only when newer
// than the last run of every job before claim preparation (SYSTEM_6 item 4, owner 2026-10-29). A person's choices
// are their own step (preparation-review) and stay. A job that joins the pipeline before claim preparation: one entry.
const BEFORE_PREPARATION = ['api-claim-recognition', 'api-member-verification', 'api-document-checking'];
const PREPARED = new Set(['api-claim-preparation', 'api-claim-revision']);
// The copy of the reviewer lines on the document check result (case-requests refreshRequestLine) is not a new check.
const isRun = (step) => !step.input?.reviewerChecklist;

// steps: the case's ApiCaseStep rows (any order). Returns only the fields some job has produced and that are current.
function apiCaseView(steps) {
  const latestDone = new Map(); // job → { output, at }
  const lastRun = new Map(); // job → time of its last real run
  for (const step of [...steps].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (step.status !== 'DONE' || !step.output) continue;
    const at = new Date(step.createdAt);
    latestDone.set(step.job, { output: step.output, at });
    if (isRun(step)) lastRun.set(step.job, at);
  }
  const current = (job) => !PREPARED.has(job) || BEFORE_PREPARATION.every((before) => !(lastRun.get(before) > latestDone.get(job).at));
  const view = {};
  for (const [field, [job, pick]] of Object.entries(FIELDS)) {
    const output = latestDone.has(job) && current(job) ? latestDone.get(job).output : undefined;
    const value = output && pick(output);
    if (value !== undefined) view[field] = value;
  }
  // The person's claim choices saved after the document check's preview (UAT 17/11): the review page shows them over the
  // preview, which was made before them. Claim preparation uses them already. The latest save holds every choice.
  // The preview's time: the document check's last real run, not a copy of its result (isRun: a request line change).
  const saved = latestDone.get('preparation-review');
  const previewAt = lastRun.get('api-document-checking');
  if (saved && previewAt && saved.at > previewAt) view.preparationChoice = stillApplies(saved.output, view);
  return view;
}

// The saved choices that still apply to the case as it is now: the same voucher (choiceFor), a benefit still on the
// member's plan, and the same diagnosis text — the rules the save and claim preparation use. The review page shows only
// these, numbered as the vouchers are now, and trusts them.
function stillApplies(choice, view) {
  const items = view.extractedFields?.invoices?.items || [];
  const plan = uniqueBenefitCandidates(view.iasMemberInfoResponse?.payload?.memberPlans);
  const onPlan = (b) => plan.some((c) => c.type === b.benefitType && (c.head || null) === (b.benefitHead || null));
  const each = (list) => items.map((item, i) => choiceFor(list, i, item)).filter(Boolean);
  const diagnosis = view.preparationPreview?.claimPrepMeta?.diagnosis;
  const sourceNow = diagnosis?.source ?? diagnosisSource(view.extractedFields?.medical);
  return {
    ...choice,
    diagnosis: choice.diagnosis && sameDiagnosis(choice.diagnosis, { source: sourceNow, text: diagnosis?.text ?? null }) ? choice.diagnosis : null,
    benefits: each(choice.benefits).filter(onPlan),
    rejections: each(choice.rejections),
  };
}

module.exports = { apiCaseView };
