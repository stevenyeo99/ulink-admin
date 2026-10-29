// Bank details that differ from IAS are a warning, and a misread account number is flagged (SYSTEM_5,
// docs/imp/CR/SYSTEM_5/PRD/BANK_CHECK_PRD.md): the IAS claim pays to the IAS account, so a difference never holds the
// case and never blocks STP.
const { evaluate, ACCEPTABLE_MEMBER_ITEMS } = require('../modules/member-verification/checks');
const { formatCheck } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { catalog } = require('../modules/ai-checklist/catalog');
const { switchable } = require('../modules/ai-checklist/switches');

const fields = (bank) => ({ claimant: { claimant_dob: '1990-01-01' }, policy: { policy_no: 'P1' }, claim: { appointment_date: '2026-10-01' }, bank });
const ias = { success: true, payload: {
  member: { DOB: '01011990', BANK_NAME: 'AYA Bank', CL_PAY_ACCT_NAME: 'Saw Wai Yan', CL_PAY_ACCT_NO: '20030586211' },
  policies: [{ POCY_REF_NO: 'P1' }], memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030' }],
} };

it('a bank difference is a warning: the member check passes, with both values', () => {
  const result = evaluate(fields({ bank_name: 'KBZ', bank_account_name: 'Saw Wai Yan', bank_account_number: '99999999999999999' }), ias);
  expect(result.outcome).toBe('MEMBER_VERIFIED');
  expect(result.bankWarning.reason).toBe('Bank details on the claim form differ from IAS: bank name ("KBZ" vs IAS "AYA Bank"); account number ("99999999999999999" vs IAS "20030586211"). The IAS claim pays to the IAS account.');
  expect(evaluate(fields({ bank_name: 'AYA', bank_account_name: 'Saw Wai Yan', bank_account_number: '20030586211' }), ias).bankWarning).toBeUndefined();
  // Switched off on the AI checklist page: no warning.
  expect(evaluate(fields({ bank_name: 'KBZ' }), ias, [], new Map([['member:bank', {}]])).bankWarning).toBeUndefined();
  // Nothing to mark OK on the review page.
  expect(ACCEPTABLE_MEMBER_ITEMS.has('member:bank')).toBe(false);
});

it('the summary shows the warning, which is not a review point', () => {
  const flag = { code: 'member:bank', reason: 'Bank details on the claim form differ from IAS: x.' };
  const summary = buildAssessmentSummary({ memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: { hard: {} }, flags: [flag] } });
  expect(summary.lines.find((l) => l.decision === 'Bank details')).toMatchObject({ result: 'Differ from IAS', why: flag.reason, review: null });
  expect(summary.reviewPoints.some((p) => p.decision === 'Bank details')).toBe(false);
  const { buildCaseJourney } = require('../modules/assessment-summary/journey');
  expect(buildCaseJourney({ currentStatus: 'API_CLAIM_REVISED' }, summary.lines)).toContainEqual({ stage: 'Bank check', result: 'Differ from IAS', why: 'A warning only: the IAS claim pays to the IAS account.' });
});

it('an account number that is not digits only is flagged as probably misread', () => {
  const check = (number) => formatCheck({ bank: { bank_account_number: number } }, '2026-10-27');
  expect(check('2003-0586 211').problems).toEqual([]);
  expect(check('၂၀၀၃၀၅၈၆၂၁၁').problems).toEqual([]);
  expect(check('2003O586211')).toMatchObject({ problems: ['Account number "2003O586211" is not digits only'], editItems: ['bank.bank_account_number'] });
  expect(formatCheck({ bank: { bank_account_number: null } }, '2026-10-27')).toBeNull();
  expect(check('-')).toBeNull();
  expect(check(' ')).toBeNull();
});

it('an account number of the wrong length for its bank holds the member check; Mark OK or a correction clears it', () => {
  const { MEMBER_ITEM_LABELS } = require('../modules/member-verification/checks');
  const iasFor = (number) => ({ ...ias, payload: { ...ias.payload, member: { ...ias.payload.member, CL_PAY_ACCT_NO: number } } });
  const check = (bankName, number, corrections) => evaluate({ ...fields({ bank_name: bankName, bank_account_number: number }), ...(corrections ? { corrections } : {}) }, iasFor(number));
  const found = (r) => (r.issues || []).find((i) => i.item === 'member:bank_number');

  for (const [bankName, ok, bad] of [['AYA', '20030586211', '2003058621'], ['CB bank', '0224100900012343', '022410090001234'], ['KBZ Bank', '12345678901234567', '123456789012345678'], ['YOMA', '123456789012345', '12345678901234']]) {
    expect({ bankName, ok: check(bankName, ok).outcome }).toEqual({ bankName, ok: 'MEMBER_VERIFIED' });
    expect({ bankName, bad: check(bankName, bad).outcome }).toEqual({ bankName, bad: 'MEMBER_REVIEW_REQUIRED' });
  }
  expect(check('UAB', '123456789012345').outcome).toBe('MEMBER_VERIFIED');
  expect(check('UAB', '1234567890123456').outcome).toBe('MEMBER_VERIFIED');
  expect(found(check('aya bank', '2003-0586-21'))).toEqual({ item: 'member:bank_number', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'Account number "2003-0586-21" has 10 digits, but AYA Bank account numbers have 11.' });
  expect(check('AYA', '၂၀၀၃၀၅၈၆၂၁၁').outcome).toBe('MEMBER_VERIFIED'); // Burmese digits count
  // The full English names too.
  for (const name of ['Ayeyarwady Bank', 'Co-operative Bank', 'Cooperative Bank', 'Kanbawza Bank', 'United Amara Bank']) {
    expect({ name, outcome: check(name, '123').outcome }).toEqual({ name, outcome: 'MEMBER_REVIEW_REQUIRED' });
  }
  expect(check('Mega Bank', '123').outcome).toBe('MEMBER_VERIFIED'); // not listed: not checked
  expect(check(null, '123').outcome).toBe('MEMBER_VERIFIED');
  expect(found(check('AYA', '2003O58621'))).toBeUndefined(); // not digits only: the format check's business

  // Mark OK covers the number the person saw; another number is held again.
  const reason = found(check('AYA', '2003058621')).reason;
  const ok = [{ kind: 'verdict', item: 'member:bank_number', corrected: true, covers: reason, by: 'ulink', reason: 'confirmed with the customer' }];
  expect(check('AYA', '2003058621', ok)).toMatchObject({ outcome: 'MEMBER_VERIFIED', accepted: [expect.objectContaining({ item: 'member:bank_number', by: 'ulink' })] });
  expect(check('AYA', '2003058622', ok).outcome).toBe('MEMBER_REVIEW_REQUIRED');
  expect(ACCEPTABLE_MEMBER_ITEMS.has('member:bank_number')).toBe(true);
  expect(MEMBER_ITEM_LABELS['member:bank_number']).toBe('Member check: bank account number');
  // Switched off on the AI checklist page: no finding.
  expect(evaluate(fields({ bank_name: 'AYA', bank_account_number: '2003058621' }), iasFor('2003058621'), [], new Map([['member:bank_number', {}]])).outcome).toBe('MEMBER_VERIFIED');
});

it('a bank ULINK gave no length for: the member check passes, and the case page shows the length as not checked', () => {
  const unlisted = evaluate(fields({ bank_name: 'MAB Bank', bank_account_number: '20030586211' }), ias);
  expect(unlisted.outcome).toBe('MEMBER_VERIFIED');
  expect(unlisted.bankNote).toEqual({ code: 'member:bank_number', reason: 'Account number length not checked: "MAB Bank" is not in ULINK\'s list of banks.' });
  expect(evaluate(fields({ bank_name: 'AYA', bank_account_number: '20030586211' }), ias).bankNote).toBeUndefined(); // listed
  expect(evaluate(fields({ bank_name: null, bank_account_number: '20030586211' }), ias).bankNote).toBeUndefined(); // no name
  expect(evaluate(fields({ bank_name: 'MAB Bank', bank_account_number: '2003O' }), ias).bankNote).toBeUndefined(); // not digits
  expect(evaluate(fields({ bank_name: 'MAB Bank', bank_account_number: '20030586211' }), ias, [], new Map([['member:bank_number', {}]])).bankNote).toBeUndefined(); // switched off

  const summary = buildAssessmentSummary({ memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: { hard: {} }, flags: [unlisted.bankNote] } });
  expect(summary.lines.find((l) => l.decision === 'Account number length')).toMatchObject({ result: 'Not checked', status: 'not_checked', why: unlisted.bankNote.reason, review: null });
  expect(summary.reviewPoints.some((p) => p.decision === 'Account number length')).toBe(false);
});

it('the AI checklist card is a warning that can be switched off', () => {
  const card = catalog().checks.find((c) => c.code === 'member:bank');
  expect(card).toMatchObject({ effect: 'warning', locked: false, ifFails: 'The case goes on, and the case page shows both values. It does not block STP.' });
  expect(card.reviewerCan).toEqual(['Correct: Bank name, Account holder, Account number']);
  expect(switchable(card)).toBe(true);
  expect(catalog().checks.filter((c) => c.locked).map((c) => c.code)).toEqual(['MEMBER_NOT_FOUND', 'COVERAGE_NOT_ACTIVE', 'member:balance', 'MISSING_VOUCHER']);
});
