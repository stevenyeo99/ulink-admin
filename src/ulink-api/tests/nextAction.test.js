// SYSTEM_4 E4-21: "Next" at the top of the case page — what has to happen and who does it, built by rules from the
// stored results (no LLM call).

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings } = require('../modules/settings/settings');
const { nextAction } = require('../modules/assessment-summary/nextAction');
const { CASE_STATUSES } = require('../modules/case-status/catalog');

const summaryWith = (...lines) => ({ lines });
const point = (decision, confidence = null) => ({ decision, confidence, review: { reason: 'AI unsure' } });

beforeEach(async () => { Setting.findAll.mockResolvedValue([]); await getSettings(); });

it('names the unsure points with their confidence for a passed-but-unsure case', () => {
  const next = nextAction({ currentStatus: 'API_DOCUMENTS_UNSURE' }, summaryWith(point('Patient name', '0.62'), { decision: 'Voucher present', review: null }));
  expect(next).toEqual({
    text: 'Step 1 of 2: documents. The documents passed, but the AI was unsure about: Patient name (62%). Check them against the documents, then Confirm and continue.',
    who: 'Claims team',
    act: true,
  });
});

it('leaves out points a person already overrode, and caps the list at three', () => {
  const lines = [point('A', '0.5'), { ...point('B'), overridden: { at: 'x' } }, point('C'), point('D'), point('E')];
  expect(nextAction({ currentStatus: 'MEMBER_REVIEW_REQUIRED' }, summaryWith(...lines)).text)
    .toBe('Member check issue: A (50%); C; D and 1 more. Fix IAS (the case is re-checked every run), or Override and continue.');
});

it("uses the job's own words for manual reading and IAS refusals", () => {
  const events = [{ newStatus: 'API_MANUAL_REVIEW', message: 'Documents too long for the AI: about 31,000 tokens, limit 24,976. A person reads them.' }];
  expect(nextAction({ currentStatus: 'API_MANUAL_REVIEW' }, null, events).text)
    .toBe('Documents too long for the AI: about 31,000 tokens, limit 24,976. A person reads them. Read the documents and handle the claim manually.');
  const refused = [{ newStatus: 'API_CLAIM_REVISION_FAILED', message: 'Claim already exists' }];
  expect(nextAction({ currentStatus: 'API_CLAIM_REVISION_FAILED' }, null, refused)).toMatchObject({ text: 'IAS refused it: Claim already exists. Fix the cause in IAS, then Try again on this page.', act: true });
});

it('waits for the customer — or tells ULINK to contact them when the missing-documents email is off', async () => {
  const fields = { currentStatus: 'API_CLAIM_SUSPENDED', documentCheckResult: { issues: ['No medical report'] } };
  expect(nextAction(fields)).toEqual({ text: 'Waiting for the customer: No medical report. Missing documents do not stop the claim: it waits in IAS as suspended until they come. When the documents come in, upload them on this page.', who: 'Customer', act: false });

  Setting.findAll.mockResolvedValue([{ key: 'apiSendMissingDocumentsEmail', value: false }]);
  await getSettings();
  expect(nextAction(fields)).toEqual({ text: 'ULINK contacts the customer: No medical report. Missing documents do not stop the claim: it waits in IAS as suspended until they come. When the documents come in, upload them on this page.', who: 'Claims team', act: true });
  expect(nextAction({ currentStatus: 'API_NO_DOCUMENTS' }).text).toBe('ULINK contacts the customer: no claim documents were received. When the documents come in, upload them on this page.');
});

it('hands a non-STP claim to JD3 with the STP reason, and says nothing is left for STP', () => {
  const nonStp = { currentStatus: 'API_CLAIM_REVISED', isStp: false, claimPrepMeta: { stp: { reasons: ['Vitamins / supplements on voucher 2 — a person approves.'] } } };
  expect(nextAction(nonStp)).toEqual({ text: 'JD3 approves the claim in IAS. Not STP because: Vitamins / supplements on voucher 2 — a person approves.', who: 'JD3', act: true });
  expect(nextAction({ currentStatus: 'API_CSR_SENT', isStp: true })).toMatchObject({ text: 'Nothing to do — paid by STP; the settlement report was sent.', act: false });
});

it('has a sentence for every status in the catalog', () => {
  for (const status of Object.keys(CASE_STATUSES)) {
    const next = nextAction({ currentStatus: status });
    expect({ status, ok: typeof next.text === 'string' && next.text.length > 10 }).toEqual({ status, ok: true });
    if (CASE_STATUSES[status].group === 'needs_review') expect({ status, act: next.act }).toEqual({ status, act: true });
  }
});

it('documents review: names why the case waits and what is missing; with the API customer email off, ULINK emails', async () => {
  Setting.findAll.mockResolvedValue([{ key: 'apiSendMissingDocumentsEmail', value: false }]);
  await getSettings();
  const fields = {
    currentStatus: 'API_DOCUMENTS_REVIEW',
    documentsHeldFor: ['a person corrected items on this case and sends the request'],
    documentCheckResult: { issues: ['Need to fill treatment date in the eye test record'] },
  };
  expect(nextAction(fields).text).toBe('Step 1 of 2: documents. The case waits for you (a person corrected items on this case and sends the request). Missing: Need to fill treatment date in the eye test record. Check the documents: if they are missing, continue (ULINK emails the customer); if they are fine, override.');
  // Email case, nothing stored about why: the old reason, and the customer is emailed.
  expect(nextAction({ currentStatus: 'DOCUMENTS_REVIEW', documentCheckResult: { issues: ['No Medical Report(s)'] } }).text)
    .toBe('The AI is unsure a document is missing. Missing: No Medical Report(s). Check the documents: if they are missing, send the request to the customer; if they are fine, override.');
});

it('preparation review: says the documents are done, or names what is missing, that the claim goes suspended and who asks', async () => {
  const fields = { currentStatus: 'API_PREPARATION_REVIEW', claimPrepMeta: { review: { diagnosis: true, vouchers: [] } } };
  expect(nextAction(fields).text).toBe('Step 2 of 2: the documents are done. Check the diagnosis code before the revision goes to IAS. If the customer must send more, add your own lines on the case page.');

  const incomplete = { ...fields, documentCheckResult: { issues: ['Need to fill treatment date in the eye test record'] } };
  const said = 'Step 2 of 2: check the diagnosis code before the revision goes to IAS. The documents are incomplete (Need to fill treatment date in the eye test record), so the claim goes to IAS as suspended.';
  expect(nextAction(incomplete).text).toBe(`${said} The customer is emailed for them. If the customer must send more, add your own lines on the case page.`);
  Setting.findAll.mockResolvedValue([{ key: 'apiSendMissingDocumentsEmail', value: false }]);
  await getSettings();
  expect(nextAction(incomplete).text).toBe(`${said} ULINK emails the customer for them. If the customer must send more, add your own lines on the case page.`);
});
