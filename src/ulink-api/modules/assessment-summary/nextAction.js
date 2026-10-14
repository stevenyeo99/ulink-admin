const { CASE_STATUSES } = require('../case-status/catalog');
const { lastReadSettings } = require('../settings/settings');

// "Next" at the top of the case page (SYSTEM_4 E4-21): in one sentence, what has to happen to this case and who does
// it — so a claims user doesn't have to read the history. Built by rules from what is stored (status, the assessment
// summary's open review points, the STP result, the last event's message); no LLM call. Console only.
//
// Returns { text, who, act }: who — 'Claims team' / 'JD3' / 'Customer' / null (nobody, the system or done);
// act — a person has to do something now.

const TEAM = 'Claims team';

// The open review points, as "<decision> (<confidence>%)", at most three.
function openPoints(summary) {
  const open = (summary?.lines || []).filter((l) => l.review && !l.overridden);
  const named = open.slice(0, 3).map((l) => (l.confidence == null ? l.decision : `${l.decision} (${Math.round(Number(l.confidence) * 100)}%)`));
  return named.length ? `${named.join('; ')}${open.length > 3 ? ` and ${open.length - 3} more` : ''}` : null;
}

const missingList = (fields) => (fields.documentCheckResult?.issues || []).join('; ') || null;

// The message of the event that put the case at its current status — the job's own words for why it stopped there.
function lastMessage(fields, events = []) {
  const event = [...events].reverse().find((e) => e.newStatus === fields.currentStatus && e.message);
  return event ? event.message.replace(/\s*\.?$/, '.') : null;
}

const act = (text, who = TEAM) => ({ text, who, act: true });
const wait = (text, who = null) => ({ text, who, act: false });

function nextAction(fields = {}, summary = null, events = []) {
  const status = fields.currentStatus;
  const points = openPoints(summary);
  const missing = missingList(fields);
  const said = lastMessage(fields, events);
  const stpReasons = (fields.claimPrepMeta?.stp?.reasons || []).join(' ');

  switch (status) {
    case 'MEMBER_REVIEW_REQUIRED':
    case 'API_MEMBER_REVIEW_REQUIRED':
      return act(`Member check issue: ${points || fields.memberVerifyResult?.reason || 'see the review points'}. Fix IAS (the case is re-checked every run), or Override and continue.`);
    case 'DOCUMENTS_REVIEW':
    case 'API_DOCUMENTS_REVIEW':
      return act(`The AI is unsure a document is missing: ${points || missing || 'see the review points'}. Check the documents, then send the request to the customer, or override if they are fine.`);
    case 'DOCUMENTS_UNSURE':
    case 'API_DOCUMENTS_UNSURE':
      return act(`The documents passed, but the AI was unsure about: ${points || 'see the review points'}. Check them against the documents, then Confirm and continue.`);
    case 'MANUAL_REVIEW':
    case 'API_MANUAL_REVIEW':
      return act(`${said || "The AI couldn't read the documents reliably."} Read the documents and handle the claim manually.`);
    case 'CONSOLE_BARCODE_MISSING':
      return act("The console barcode hasn't arrived. Check the console upload; the case is still checked every run.");
    case 'CASE_NUMBER_UNCLEAR':
      return act("The TPA case number on the form isn't AYA-CL- followed by 8 digits. Check the form, fix it, then reset the case.");
    case 'CONSOLE_UPLOAD_FAILED':
      return act(`${said || 'The console upload was refused.'} Fix it, then reset the case.`);
    case 'INCOMPLETE':
      return wait(`Waiting for the customer's documents${missing ? `: ${missing}` : ''}. Their reply restarts the case.`, 'Customer');
    case 'API_NO_DOCUMENTS':
    case 'API_CLAIM_SUSPENDED': {
      const what = status === 'API_NO_DOCUMENTS' ? 'no claim documents were received' : missing || 'the missing documents';
      // Missing-documents email switched off (SYSTEM_4 E4-03): nobody emailed the customer — ULINK has to.
      if (!lastReadSettings().apiSendMissingDocumentsEmail) {
        return act(`ULINK contacts the customer: ${what}.${status === 'API_CLAIM_SUSPENDED' ? ' The claim is suspended in IAS.' : ''}`);
      }
      return wait(`Waiting for the customer: ${what}.${status === 'API_CLAIM_SUSPENDED' ? ' The claim is suspended in IAS.' : ''}`, 'Customer');
    }
    case 'CLAIM_CREATED':
    case 'API_CLAIM_REVISED':
      if (fields.isStp) return wait('Nothing to do — STP; the settlement report follows.');
      return act(`JD3 approves the claim in IAS.${stpReasons ? ` Not STP because: ${stpReasons}` : ''}`, 'JD3');
    case 'CSR_SENT':
    case 'API_CSR_SENT':
      return wait('Nothing to do — paid by STP; the settlement report was sent.');
    case 'NOT_RECOGNIZED':
      return wait("Nothing to do — not a claim we handle; the sender was told.");
    case 'CLAIM_SUBMIT_FAILED':
    case 'API_CLAIM_REVISION_FAILED':
      return act(`IAS refused it${said ? `: ${said}` : '.'} Fix it in IAS; it is not retried automatically.`);
    case 'CONSOLE_BARCODE_PENDING':
      return wait('Nothing to do — waiting for the console barcode (usually 15–30 minutes).');
    case 'API_AWAITING_CSR':
      return wait("Nothing to do — waiting for IAS's settlement report.");
    default:
      break;
  }

  const info = CASE_STATUSES[status];
  if (info?.group === 'in_progress') return wait('Nothing to do — the system continues on the next run.');
  if (info?.group === 'needs_review') return act(`${info.description}`);
  return wait(info?.description || 'Nothing to do.');
}

module.exports = { nextAction };
