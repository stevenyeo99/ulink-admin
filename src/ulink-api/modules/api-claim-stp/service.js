const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { runApiJob } = require('../api-pipeline/runApiJob');
const { checkClaimStatus, csrDestination } = require('../ias-claim-stp/service');
const { downloadFile } = require('../ias-claim-stp/iasClaimStatusClient');

// api-claim-stp: API case workflow, last job (docs/imp/day1/api-case-workflow.md section 6.8).
//
//   input:  { 'api-claim-intake': { clNo } }
//   output: { filename, filepath, csrFilePath, email }   (or WAITING while the report isn't ready)
//
// Same as the email flow's ias-claim-stp, reusing its exported pieces unchanged: checkClaimStatus
// polls IAS claim status for the settlement report (CSR), and the PDF is downloaded to the same
// CSR_UPLOAD_ROOT layout (csrDestination). The customer email (CSR_REPORT, PDF attached) is sent
// by api-email-sender. Only STP claims get here — api-claim-revision moves them to
// API_AWAITING_CSR; a non-STP claim ends at API_CLAIM_REVISED for JD2, as in the email flow.

async function writeToCsrRoot(key, bytes) {
  const root = path.resolve(config.csrUpload.root);
  const fullPath = path.join(root, key);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, bytes);
  return fullPath;
}

async function processCase({ caseRecord, input }) {
  const claimNo = input['api-claim-intake'].clNo;
  const status = await checkClaimStatus({ id: caseRecord.id, claimNo });
  // Not ready yet is a normal wait, not a failure (same as the email flow).
  if (!status.ready) return { wait: true, output: { reason: 'Settlement report not ready in IAS yet' } };

  const bytes = await downloadFile({ filepath: status.filepath, filename: status.filename });
  const csrFilePath = await writeToCsrRoot(csrDestination({ now: new Date(), claimNo, filename: status.filename }), bytes);

  return {
    output: {
      filename: status.filename,
      filepath: status.filepath,
      csrFilePath,
      // Same task and payload as the email flow's CSR_REPORT.
      email: { taskType: 'CSR_REPORT', audience: 'customer', payload: { csrFilePath, claimNo }, dedupeKey: status.filename },
    },
    nextStatus: 'API_CSR_SENT',
    message: `Settlement report ${status.filename} downloaded to ${csrFilePath}`,
  };
}

const job = {
  name: 'api-claim-stp',
  inputStatus: 'API_AWAITING_CSR',
  inputs: ['api-claim-intake'],
  batchLimit: config.csrUpload.batchLimit,
  process: processCase,
};

module.exports = { run: () => runApiJob(job), job };
