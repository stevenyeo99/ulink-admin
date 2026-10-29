// Member check per item (owner, 2026-10-19): a reviewer marks each member finding OK on its own (a "member:…" verdict
// correction). The case goes on only when none is left; coverage is never marked OK this way; a misread value is still
// corrected and checked again; the AI does not learn from it (member-verification is rules on IAS, not AI).

const { evaluate } = require('../modules/member-verification/checks');
const { correctionOptions, validateCorrection, recheckFrom } = require('../modules/ai-feedback/corrections');

// A different policy number and date of birth: two findings (a bank difference is a warning only, SYSTEM_5 bank check).
const fields = (corrections = []) => ({
  claim: { accident_date: null, appointment_date: '2026-09-01' },
  claimant: { claimant_dob: '1990-01-01' },
  policy: { policy_no: 'POL2' },
  bank: { bank_name: 'AYA', bank_account_name: 'Thiha', bank_account_number: '12345678901' },
  corrections,
});
const ias = {
  success: true,
  payload: {
    member: { DOB: '02021991', BANK_NAME: 'X Bank', CL_PAY_ACCT_NAME: 'Someone', CL_PAY_ACCT_NO: '999' },
    policies: [{ POCY_REF_NO: 'POL1' }],
    memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030' }],
  },
};
// A Mark OK covers the finding the person saw (its text, with both values).
const findingText = (item, f = fields(), i = ias) => evaluate(f, i).issues.find((x) => x.item === item)?.reason;
const ok = (item, covers = findingText(item)) => ({ kind: 'verdict', item, corrected: true, by: 'Ulink (ulink)', reason: 'IAS has the old policy number', covers });

it('each member finding is its own item', () => {
  expect(evaluate(fields(), ias).issues.map((i) => i.item)).toEqual(['member:dob', 'member:policy']);
});

it('one finding marked OK: still held for the other, which is shown with who accepted the first', () => {
  const result = evaluate(fields([ok('member:policy')]), ias);
  expect(result).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'MEMBER_DETAILS_MISMATCH', issues: [{ item: 'member:dob' }] });
  expect(result.accepted).toEqual([expect.objectContaining({ item: 'member:policy', by: 'Ulink (ulink)', acceptedReason: 'IAS has the old policy number' })]);
});

it('every finding marked OK: the member check passes', () => {
  expect(evaluate(fields([ok('member:policy'), ok('member:dob')]), ias)).toMatchObject({ outcome: 'MEMBER_VERIFIED', accepted: [{ item: 'member:dob' }, { item: 'member:policy' }] });
});

it('a changed finding (another policy number) is held again: the Mark OK covered only what the person saw', () => {
  const changed = { ...fields([ok('member:policy'), ok('member:dob')]), policy: { policy_no: 'POL3' } };
  expect(evaluate(changed, ias)).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'MEMBER_DETAILS_MISMATCH', issues: [{ item: 'member:policy' }] });
});

it('no member result offered (the case is not held by the member check): no member Mark OK', () => {
  expect(correctionOptions(fields(), null, null).some((o) => o.item.startsWith('member:'))).toBe(false);
});

it('coverage is never marked OK this way (the whole-check override stays for it)', () => {
  const outside = { ...ias, payload: { ...ias.payload, memberPlans: [{ EFF_DATE: '01012027', EXP_DATE: '01012030' }] } };
  const result = evaluate(fields([ok('member:coverage', 'x'), ok('member:policy', findingText('member:policy', fields(), outside)), ok('member:dob', findingText('member:dob', fields(), outside))]), outside);
  expect(result).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'COVERAGE_NOT_ACTIVE' });
  const options = correctionOptions(fields(), null, result);
  expect(options.some((o) => o.item === 'member:coverage')).toBe(false);
});

it('offers Mark OK (passed only) for each open member finding, and checks the member again after it', () => {
  const memberVerifyResult = evaluate(fields(), ias);
  const options = correctionOptions(fields(), null, memberVerifyResult);
  const policy = options.find((o) => o.item === 'member:policy');
  expect(policy).toMatchObject({ kind: 'verdict', label: 'Member check: policy number', current: false, canFail: false, note: expect.stringContaining('Policy number') });
  expect(options.some((o) => o.item === 'member:bank')).toBe(false);
  expect(validateCorrection({ kind: 'verdict', item: 'member:policy', passed: true, reason: 'IAS has the old policy number', wrongStep: 'check' }, options).corrected).toBe(true);
  expect(validateCorrection({ kind: 'verdict', item: 'member:policy', passed: false, reason: 'x x x', wrongStep: 'check' }, options).error).toBeDefined();
  expect(recheckFrom('member:policy', 'API_MEMBER_REVIEW_REQUIRED').API).toBe('API_RECOGNIZED');
});

it('a member Mark OK reads as accepted, not as an AI mistake', () => {
  const { correctionText } = require('../modules/ai-feedback/corrections');
  expect(correctionText({ item: 'member:bank', label: 'Member check: bank details', by: 'Ulink (ulink)', reason: 'IAS has no bank on file' }))
    .toBe('Member check: bank details: marked OK by Ulink (ulink) — IAS has no bank on file');
});
