// AiSummaryRemark (IAS claim submission / revision): the AI assessment text, top level, up to 10,000
// characters (confirmed by the IAS team 2026-09-29) — cut with a note when longer.

const { aiSummaryRemark, MAX_LENGTH } = require('../modules/ias-claim-preparation/aiSummaryRemark');

const fields = {
  createdAt: '2026-09-29T01:00:00Z',
  recognizedType: 'ayas_member_claim',
  currentStatus: 'CLAIM_PAYLOAD_PREPARED',
  memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: { hard: { dobMatch: true } } },
  isStp: false,
  claimPrepMeta: { stp: { source: 'EMAIL', currency: 'MMK', benefits: [], reasons: ['IP is not allowed for STP.'] } },
};

it('is the assessment text: the path first, ending where the case is when sent', () => {
  const remark = aiSummaryRemark(fields);
  expect(remark).toMatch(/^Why the case went this way:\n1\. Received — Claim email/);
  expect(remark).toContain('STP — No: IP is not allowed for STP. (email case rules)');
  expect(remark).toContain('Now — Claim prepared');
  expect(remark).toContain('Decisions:');
});

it('marks a check a person overrode as handled', () => {
  const held = { ...fields, memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'Bank differs.' } };
  expect(aiSummaryRemark(held, [{ area: 'member', at: null, note: 'Overridden by Ops — bank confirmed by phone' }]))
    .toContain('Overridden by a person: Overridden by Ops — bank confirmed by phone');
});

it('stays within 10,000 characters, with a note when cut', () => {
  const long = { ...fields, memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'MEMBER_DETAILS_MISMATCH', reason: 'x'.repeat(20000) } };
  const remark = aiSummaryRemark(long);
  expect(remark).toHaveLength(MAX_LENGTH);
  expect(remark.endsWith('… (cut to fit; full assessment in the ULINK console)')).toBe(true);
});
