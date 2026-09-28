// Review Queue rule (modules/review-queue/queue.js): who is in it, under which reason, and what to check.

const { queueEntry } = require('../modules/review-queue/queue');

const unreadableRecord = { documentCheckResult: { checklist: [{ code: 'INCOMPLETE_MEDICAL_REPORT', label: 'x', passed: false }] } };
const missingOnly = { documentCheckResult: { checklist: [{ code: 'MISSING_MANDATORY_FIELD', label: 'Case Number', passed: false }] } };
const unsureDiagnosis = { claimPrepMeta: { diagnosis: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0 } } };

it('queues a needs-review status even without assessment points, with a reason from the status', () => {
  expect(queueEntry('API_MANUAL_REVIEW', {})).toMatchObject({ reason: 'Unreadable', pointCount: 0 });
  expect(queueEntry('MEMBER_REVIEW_REQUIRED', {})).toMatchObject({ reason: 'Data mismatch' });
});

it('queues an IAS rejection as a system issue', () => {
  expect(queueEntry('CLAIM_SUBMIT_FAILED', {})).toMatchObject({ reason: 'System issue', check: expect.stringContaining('IAS rejected') });
});

it('queues an open case with a point for the team, under its most serious reason', () => {
  const entry = queueEntry('API_CLAIM_SUSPENDED', { ...unreadableRecord, ...unsureDiagnosis });
  expect(entry).toMatchObject({ reason: 'Unreadable', reasons: ['Unreadable', 'AI unsure'], pointCount: 2 });
  expect(entry.check).toBe('Medical record readable: Look at the document image yourself.');
});

it("doesn't raise again the points of a check a person overrode, but still raises new ones", () => {
  const bankMismatch = { memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x' } };
  const memberOverride = { area: 'member', at: null, note: 'Overridden by Ulink (ulink) — The customer\'s details were confirmed: phoned.' };

  // Member check overridden, case now checking documents: the bank point was dealt with.
  expect(queueEntry('READY_FOR_DOCUMENT_CHECKING', bankMismatch, [memberOverride])).toBeNull();
  expect(queueEntry('READY_FOR_DOCUMENT_CHECKING', bankMismatch)).toMatchObject({ reason: 'Data mismatch' });

  // …but a document problem found after the override still queues it.
  expect(queueEntry('API_CLAIM_SUSPENDED', { ...bankMismatch, ...unreadableRecord }, [memberOverride])).toMatchObject({ reason: 'Unreadable', pointCount: 1 });
});

it('leaves out cases only waiting on the customer, and finished cases', () => {
  expect(queueEntry('INCOMPLETE', missingOnly)).toBeNull();
  expect(queueEntry('API_CSR_SENT', unsureDiagnosis)).toBeNull();
  expect(queueEntry('NOT_RECOGNIZED', {})).toBeNull();
  expect(queueEntry('API_RECEIVED', {})).toBeNull();
});
