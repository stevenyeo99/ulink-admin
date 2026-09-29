const { evaluate } = require('../modules/member-verification/checks');

// Regression test for the 2026-09-16 bank_account_name honorific fix (see checks.js's
// compareAccountHolderName) — this is a payment-safety gate, so the fix must tolerate a
// leading honorific ("U Thiha" vs IAS's "Thiha") without also starting to tolerate a
// genuinely different payee's name.
function baseFields(bankAccountName) {
  return {
    claim: { accident_date: null, appointment_date: '2026-09-01' },
    claimant: { claimant_dob: '1990-01-01' },
    policy: { policy_no: 'POL1' },
    bank: { bank_name: 'AYA', bank_account_name: bankAccountName, bank_account_number: '1234567890' },
  };
}

function baseIasResponse(payAcctName) {
  return {
    success: true,
    payload: {
      member: { DOB: '01011990', BANK_NAME: 'AYA Bank', CL_PAY_ACCT_NAME: payAcctName, CL_PAY_ACCT_NO: '1234567890' },
      policies: [{ POCY_REF_NO: 'POL1' }],
      memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030' }],
    },
  };
}

describe('bankAccountNameMatch honorific tolerance', () => {
  it('tolerates a leading honorific that IAS does not store', () => {
    const result = evaluate(baseFields('U Thiha'), baseIasResponse('Thiha'));
    expect(result.checks.hard.bankAccountNameMatch).toBe(true);
    expect(result.outcome).toBe('MEMBER_VERIFIED');
  });

  it('still exact-matches when neither side has a honorific', () => {
    const result = evaluate(baseFields('Thiha'), baseIasResponse('Thiha'));
    expect(result.checks.hard.bankAccountNameMatch).toBe(true);
  });

  it('still fails a genuinely different payee name', () => {
    const result = evaluate(baseFields('Nay Thiha Aung'), baseIasResponse('Thiha'));
    expect(result.checks.hard.bankAccountNameMatch).toBe(false);
    expect(result.outcome).toBe('MEMBER_REVIEW_REQUIRED');
    expect(result.reasonCode).toBe('BANK_DETAILS_MISMATCH');
  });
});

// Enhancement A2 (2026-09-29): every failed check is reported, not only the first.
describe('reports every problem', () => {
  it('lists a DOB and a bank mismatch together; the first stays the reasonCode', () => {
    const fields = { ...baseFields('Nay Thiha Aung'), claimant: { claimant_dob: '1991-01-01' } };
    const result = evaluate(fields, baseIasResponse('Thiha'));
    expect(result.reasonCode).toBe('MEMBER_DETAILS_MISMATCH');
    expect(result.issues.map((i) => i.reasonCode)).toEqual(['MEMBER_DETAILS_MISMATCH', 'BANK_DETAILS_MISMATCH']);
    expect(result.reason).toMatch(/^1\. Claimant DOB .* 2\. Bank details do not match IAS record: account name/);
  });

  it('keeps the single-problem reason unnumbered', () => {
    const result = evaluate(baseFields('Nay Thiha Aung'), baseIasResponse('Thiha'));
    expect(result.issues).toHaveLength(1);
    expect(result.reason).toMatch(/^Bank details do not match/);
  });
});

// Dates in reasons are YYYY-MM-DD on both sides (IAS sends MMDDYYYY), so a mismatch is readable.
describe('readable dates in reasons', () => {
  it('shows the IAS DOB and the coverage period as YYYY-MM-DD', () => {
    const dob = evaluate({ ...baseFields('Thiha'), claimant: { claimant_dob: '1991-01-01' } }, baseIasResponse('Thiha'));
    expect(dob.reason).toBe('Claimant DOB "1991-01-01" does not match IAS record DOB "1990-01-01".');

    const lapsed = evaluate({ ...baseFields('Thiha'), claim: { appointment_date: '2031-05-02' } }, baseIasResponse('Thiha'));
    expect(lapsed.reason).toBe('Treatment date 2031-05-02 falls outside the active coverage period (2020-01-01 to 2030-01-01).');
  });
});

