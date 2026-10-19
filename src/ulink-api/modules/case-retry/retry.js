// Try again (owner, 2026-10-19): a case IAS or the console refused stops at a "system issue" status that no job takes
// again. After a person fixed the cause (usually in IAS), they move it back one step with a
// button and a comment; the next pipeline run does the rest with the usual jobs. Any logged-in user (every reviewer).
//
//   send     — the same claim / revision, unchanged (claim creation / revision takes it again)
//   prepare  — claim preparation again first (diagnosis, benefit, amounts, STP), then sent
//   upload   — the documents to the console again (only when the console refused them: a file the console took
//              without a scan id is there already — sending it again would make a duplicate)

const ACTIONS = {
  send: 'Send again',
  prepare: 'Prepare again',
  upload: 'Upload again',
};

const RETRY = {
  CLAIM_SUBMIT_FAILED: { send: 'CLAIM_PAYLOAD_PREPARED', prepare: 'DOCUMENTS_UPLOADED' },
  API_CLAIM_REVISION_FAILED: { send: 'API_CLAIM_PAYLOAD_PREPARED', prepare: 'API_READY_FOR_CLAIM_PREPARATION' },
  CONSOLE_UPLOAD_FAILED: { upload: 'MEMBER_VERIFIED' },
  API_CONSOLE_UPLOAD_FAILED: { upload: 'API_DOCUMENTS_VERIFIED' },
};

/**
 * What a person can try again on a case at this status, or null. consoleUploadReason: api-console-upload's reasonCode
 * for API_CONSOLE_UPLOAD_FAILED (CONSOLE_UPLOAD_REFUSED / CONSOLE_SCAN_ID_UNKNOWN).
 * Returns { actions: [{ id, label, target }], note }.
 */
function retryOptions(status, { consoleUploadReason = null } = {}) {
  const targets = RETRY[status];
  if (!targets) return null;
  if (status === 'API_CONSOLE_UPLOAD_FAILED' && consoleUploadReason !== 'CONSOLE_UPLOAD_REFUSED') {
    return {
      actions: [],
      note: 'The console took the file but did not say where it filed it. Check the IAS console; uploading again would make a duplicate.',
    };
  }
  return {
    actions: Object.entries(targets).map(([id, target]) => ({ id, label: ACTIONS[id], target })),
    note: 'Fix the cause first (usually in IAS) — the same data would be refused again. Prepare again also rebuilds the diagnosis, benefit and amounts.',
  };
}

// Why the last console upload of an API case failed (its latest DONE api-console-upload step), from the case's steps in
// time order — one rule for showing the Upload again button and for accepting it.
const consoleUploadReasonOf = (steps) => steps.filter((s) => s.job === 'api-console-upload' && s.status === 'DONE').at(-1)?.output?.reasonCode ?? null;

module.exports = { retryOptions, consoleUploadReasonOf, RETRY, ACTIONS };
