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
