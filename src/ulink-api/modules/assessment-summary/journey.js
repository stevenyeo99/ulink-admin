// "Why the case went this way" (17/09 meeting, item 5 of the meeting notes, 2026-09-29): the case's path
// through the flow, one step per stage, each with its result and the reason — so a reviewer reading
// the console or an internal email sees why the system took this path, not only what happened.
//
// Built from the same case fields as the assessment (email cases: ulink_cases; API cases:
// apiCaseView) plus the assessment's own lines for the reasons. Pure: no DB, no LLM. A stage the
// case hasn't reached yet is left out; the last step says where the case is now and who acts next.

const { CASE_STATUSES } = require('../case-status/catalog');

const IAS_ACCEPTED = {
  CLAIM_CREATED: 'Claim {claimNo} created in IAS.',
  CSR_SENT: 'Claim {claimNo} created in IAS.',
  API_CLAIM_REVISED: 'Claim {claimNo} revised in IAS.',
  API_AWAITING_CSR: 'Claim {claimNo} revised in IAS.',
  API_CSR_SENT: 'Claim {claimNo} revised in IAS.',
  API_CLAIM_SUSPENDED: 'Claim {claimNo} revised in IAS with suspense (documents missing).',
};
const IAS_REJECTED = new Set(['CLAIM_SUBMIT_FAILED', 'API_CLAIM_REVISION_FAILED']);
const NOT_READ = {
  NOT_RECOGNIZED: 'Not a claim type we handle; the sender was asked to contact customer service.',
  MANUAL_REVIEW: "The AI couldn't read the documents reliably.",
  API_MANUAL_REVIEW: "The AI couldn't read the documents reliably.",
};

const step = (stage, result, why = null) => ({ stage, result, why: why || null });
const handled = (line) => (line.overridden ? ` Overridden by a person: ${line.overridden.note}` : '');

function buildCaseJourney(fields = {}, lines = []) {
  const steps = [];
  const status = fields.currentStatus;
  const find = (decision) => lines.find((l) => l.decision === decision);

  if (fields.createdAt) {
    const on = new Date(fields.createdAt).toISOString().slice(0, 10);
    steps.push(step('Received', fields.source === 'API' ? `IAS API claim${fields.claimNo ? ` ${fields.claimNo}` : ''}` : 'Claim email', `On ${on}.`));
  }

  if (fields.recognizedType) steps.push(step('Recognised', 'Read by AI', `Read as ${fields.recognizedType}.`));
  else if (NOT_READ[status]) steps.push(step('Recognised', 'Not read', NOT_READ[status]));

  const member = find('Member check');
  if (member) steps.push(step('Member check', member.result, `${member.why || ''}${handled(member)}`.trim()));

  // Advisory warnings from the member check (possible policy exclusion, benefit not on the plan): they
  // don't stop the case, but JD2 should weigh them — so the path says so.
  for (const warning of lines.filter((l) => l.decision === 'Policy exclusion' || l.decision === 'Benefit eligibility')) {
    steps.push(step('Policy check', warning.result, `${warning.brief || warning.why}${handled(warning)}`));
  }

  const documents = lines.filter((l) => l.area === 'documents');
  if (documents.length) {
    const open = documents.filter((l) => l.status === 'issue' && !l.overridden);
    const overridden = documents.filter((l) => l.overridden);
    steps.push(step(
      'Documents',
      open.length ? 'Incomplete' : 'Complete',
      open.length
        ? open.map((l) => `${l.decision}: ${l.result}`).join('; ') + '.'
        : overridden.length ? `Overridden by a person: ${overridden[0].overridden.note}` : 'All checks passed.'
    ));
  }

  // Console upload by API (cl-upload): the barcode comes back later, so say whether it has — a case
  // waiting here is expected, not stuck (docs/imp/demo/API DAY1/CL-UPLOAD SPEC/console_upload_requirement.md).
  const upload = fields.consoleUploadResult;
  if (upload?.method === 'cl-upload') {
    const at = `${String(upload.uploadedAt).slice(0, 16).replace('T', ' ')} UTC`;
    const [first, ...more] = upload.barcodes || [];
    steps.push(first
      ? step('Console upload', 'Barcode received', `Uploaded ${at} as ${upload.file}; barcode ${first.barcodeId}${more.length ? ` (+${more.length} supplementary)` : ''}.`)
      : step('Console upload', 'Waiting for barcode', `Uploaded ${at} as ${upload.file}; the console creates barcodes about every 15 minutes.`));
  }

  const diagnosis = find('Diagnosis code');
  // The AI's full reasoning is in the assessment; here just how it was picked and how sure.
  if (diagnosis) {
    steps.push(step('Diagnosis', diagnosis.result, [diagnosis.verified, diagnosis.confidence && `confidence ${diagnosis.confidence}`].filter(Boolean).join(', ') + '.'));
  }

  const benefits = lines.filter((l) => l.decision.startsWith('Benefit ('));
  if (benefits.length) steps.push(step('Benefit', benefits.map((l) => l.result).join(', ')));

  const stp = find('STP');
  if (stp) steps.push(step('STP', stp.result, stp.why));

  if (IAS_ACCEPTED[status]) {
    steps.push(step('IAS', 'Accepted', IAS_ACCEPTED[status].replace('{claimNo}', fields.claimNo ?? '')));
  } else if (IAS_REJECTED.has(status)) {
    steps.push(step('IAS', 'Rejected', fields.iasClaimResult?.error || 'IAS rejected the claim.'));
  }

  const now = CASE_STATUSES[status];
  if (now) {
    // "Created in IAS" covers both paths; say which one this case is on.
    const next = status === 'CLAIM_CREATED'
      ? (fields.isStp ? 'STP claim: waiting for the settlement report from IAS.' : 'Waiting for JD2 approval in IAS.')
      : now.description;
    steps.push(step('Now', now.label, next));
  }
  return steps;
}

function caseJourneyText(steps) {
  return steps.map((s, i) => `${i + 1}. ${s.stage} — ${s.result}${s.why ? `: ${s.why}` : ''}`).join('\n');
}

// The case-level fields the journey reads that a job's own result doesn't carry — for jobs building an
// email while the case row is still at its previous status (they add currentStatus themselves).
function caseBasics(caseRecord) {
  const { source, claimNo, createdAt, recognizedType } = caseRecord;
  return { source, claimNo, createdAt, recognizedType };
}

module.exports = { buildCaseJourney, caseJourneyText, caseBasics };
