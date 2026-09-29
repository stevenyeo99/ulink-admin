// "Why the case went this way" (modules/assessment-summary/journey.js): each stage the case reached,
// its result and the reason, ending with where the case is now — email and API cases alike.

const { buildAssessmentSummary, assessmentSummaryText } = require('../modules/assessment-summary/summary');

const verified = { outcome: 'MEMBER_VERIFIED', checks: { hard: { dobMatch: true, policyNoMatch: true } } };
const stp = { source: 'API', currency: 'MMK', benefits: [{ benefitType: 'OP', total: 23000, allowed: true, limit: 100000 }], reasons: [] };
const journeyOf = (fields) => buildAssessmentSummary(fields).journey;

it('tells an STP API case from receipt to the settlement report', () => {
  const journey = journeyOf({
    source: 'API', claimNo: '2609170003', createdAt: '2026-09-28T02:00:00Z', recognizedType: 'ayas_member_claim',
    currentStatus: 'API_CSR_SENT', memberVerifyResult: verified,
    documentCheckResult: { checklist: [], details: [] },
    claimPrepMeta: { diagnosis: { pick: { diagCode: 'J06.9', diagDesc: 'URTI' }, defaulted: false, confidence: 0.8, reason: 'Sore throat.' }, lines: [{ pick: { benefitType: 'OP', benefitHead: 'GP' }, confidence: 0.9 }], stp },
    isStp: true,
  });
  expect(journey.map((s) => s.stage)).toEqual(['Received', 'Recognised', 'Member check', 'Diagnosis', 'Benefit', 'STP', 'IAS', 'Now']);
  expect(journey[0]).toEqual({ stage: 'Received', result: 'IAS API claim 2609170003', why: 'On 2026-09-28.' });
  expect(journey.find((s) => s.stage === 'STP')).toMatchObject({ result: 'Yes', why: 'OP 23,000 MMK ≤ limit 100,000 (API case rules)' });
  expect(journey.find((s) => s.stage === 'IAS').why).toBe('Claim 2609170003 revised in IAS.');
  expect(journey.at(-1)).toMatchObject({ stage: 'Now', result: 'Settlement report sent' });
});

it('says why a case is on hold, and that a non-STP claim waits for JD2', () => {
  const hold = journeyOf({
    createdAt: '2026-09-29T01:00:00Z', recognizedType: 'ayas_member_claim', currentStatus: 'MEMBER_REVIEW_REQUIRED',
    memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'Bank details do not match IAS record.' },
  });
  expect(hold.map((s) => s.stage)).toEqual(['Received', 'Recognised', 'Member check', 'Now']);
  expect(hold[2]).toEqual({ stage: 'Member check', result: 'BANK_DETAILS_MISMATCH', why: 'Bank details do not match IAS record.' });

  const jd2 = journeyOf({ createdAt: '2026-09-29T01:00:00Z', currentStatus: 'CLAIM_CREATED', claimNo: 'CL-1', isStp: false });
  expect(jd2.at(-2)).toMatchObject({ stage: 'IAS', why: 'Claim CL-1 created in IAS.' });
  expect(jd2.at(-1).why).toBe('Waiting for JD2 approval in IAS.');
});

it('puts the journey first in the email text', () => {
  const text = assessmentSummaryText(buildAssessmentSummary({ createdAt: '2026-09-29T01:00:00Z', currentStatus: 'CLAIM_SUBMIT_FAILED', iasClaimResult: { error: 'Claim already exists' }, memberVerifyResult: verified }));
  expect(text).toMatch(/^Why the case went this way:\n1\. Received — Claim email: On 2026-09-29\.\n2\. Member check — Verified/);
  expect(text).toContain('IAS — Rejected: Claim already exists');
});
