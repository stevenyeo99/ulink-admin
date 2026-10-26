// SYSTEM_5 member balance phase D: the balance lines in the assessment summary (case page, team emails, IAS remark).
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');

const lines = [
  { voucher: 1, enough: true, text: 'Voucher 1 (IP Inpatient / SUR Surgeon’s Fee): voucher 5,000,000, balance 8,587,070 (CT combined), enough' },
  { voucher: 2, enough: false, text: 'Voucher 2 (IP Inpatient / SUR Surgeon’s Fee): voucher 5,000,000, balance left 3,587,070 (CT combined), not enough' },
];
const find = (summary, decision) => summary.lines.find((l) => l.decision === decision);

it('shows the member check balance, one text per voucher with its codes', () => {
  const summary = buildAssessmentSummary({ memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: {}, balance: { checked: true, lines } } });
  expect(find(summary, 'Member balance')).toMatchObject({ result: 'Not enough', status: 'issue' });
  expect(find(summary, 'Member balance').why).toContain('Voucher 2 (IP Inpatient / SUR Surgeon’s Fee)');
});

it('says why the balance was not checked', () => {
  const summary = buildAssessmentSummary({ memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: {}, balance: { checked: false, note: 'IAS did not return the balance.' } } });
  expect(find(summary, 'Member balance')).toMatchObject({ result: 'Not checked', why: 'IAS did not return the balance.' });
});

it('shows the second check before the claim, and a bypassed shortfall as such', () => {
  const summary = buildAssessmentSummary({ claimPrepMeta: { balance: { checked: true, lines, uncovered: [] } } });
  expect(find(summary, 'Balance before the claim')).toMatchObject({ result: 'Not enough' });
  expect(find(summary, 'Balance before the claim').why).toContain('A person bypassed the shortfall at member review.');
});
