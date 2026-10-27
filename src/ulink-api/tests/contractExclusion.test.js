// The policy contract exclusion holds the case for a person (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/CONTRACT_EXCLUSION_PRD.md):
// the AI answer is reused while the text is unchanged, a person marks it as not applying (STP stays possible) or lets it
// go on (never STP), and the answer covers only the clause and the text it saw.
jest.mock('../modules/policy-exclusion/lookup', () => ({ findCandidates: jest.fn(async () => [{ clauseRef: '6.22', clauseText: 'Weight loss or weight problems.' }]) }));
jest.mock('../modules/policy-exclusion/judge', () => ({ judgeExclusion: jest.fn() }));
jest.mock('../modules/policy-exclusion/overrideLookup', () => ({ findOverrides: jest.fn(async () => []) }));

const { judgeExclusion } = require('../modules/policy-exclusion/judge');
const { checkExclusions } = require('../modules/member-verification/exclusionFlags');
const { evaluate } = require('../modules/member-verification/checks');
const { validateCorrection } = require('../modules/ai-feedback/corrections');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { catalog } = require('../modules/ai-checklist/catalog');

const judgment = { clauseRef: '6.22', clauseText: 'Weight loss or weight problems.', severity: 'exclude', confidence: 0.82, reason: 'Treatment is Tirzepatide with BMI 30.2.' };
const fields = (diagnosis = 'Obesity', corrections = []) => ({
  medical: { detail_of_illness_injury: diagnosis, full_description_of_treatment: 'Tirzepatide' },
  claimant: { claimant_dob: '1990-01-01' }, policy: { policy_no: 'P1' }, claim: { appointment_date: '2026-10-01' },
  corrections,
});
const ias = { success: true, payload: { member: { DOB: '01011990' }, policies: [{ POCY_REF_NO: 'P1' }], memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030' }] } };

beforeEach(() => judgeExclusion.mockReset().mockResolvedValue(judgment));

it('raises a member finding with the clause, the confidence and the reason, and reuses the AI answer while the text is unchanged', async () => {
  const first = await checkExclusions(fields(), 'ayas_member_claim');
  expect(first.issue).toMatchObject({ item: 'member:contract_exclusion', reasonCode: 'POSSIBLE_EXCLUSION', coverKeys: [`6.22@${first.fingerprint}`] });
  expect(first.issue.reason).toBe('Possible policy contract exclusion: clause 6.22 "Weight loss or weight problems" (confidence 0.82). AI: Treatment is Tirzepatide with BMI 30.2.');

  const again = await checkExclusions(fields(), 'ayas_member_claim', { fingerprint: first.fingerprint, flag: first.flag });
  expect(judgeExclusion).toHaveBeenCalledTimes(1);
  expect(again.issue).toEqual(first.issue);

  // A corrected diagnosis is judged again.
  await checkExclusions(fields('Diabetes'), 'ayas_member_claim', { fingerprint: first.fingerprint, flag: first.flag });
  expect(judgeExclusion).toHaveBeenCalledTimes(2);

  // A clause that limits the amount says so (Q4); no text: nothing to judge.
  judgeExclusion.mockResolvedValue({ ...judgment, severity: 'cap' });
  expect((await checkExclusions(fields('Other'), 'ayas_member_claim')).issue.reason).toContain('The clause limits the amount.');
  expect(await checkExclusions({ medical: {} }, 'ayas_member_claim')).toBeNull();
});

it('holds the member check until a person answers for this clause and this text', async () => {
  const { issue } = await checkExclusions(fields(), 'ayas_member_claim');
  expect(evaluate(fields(), ias, [issue])).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'POSSIBLE_EXCLUSION' });

  const answer = (wrongStep, coverKeys) => ({ kind: 'verdict', item: 'member:contract_exclusion', corrected: true, by: 'Ops', reason: 'Diet program, not weight loss', wrongStep, coverKeys });
  const notApplying = evaluate(fields('Obesity', [answer('check', issue.coverKeys)]), ias, [issue]);
  expect(notApplying.outcome).toBe('MEMBER_VERIFIED');
  expect(notApplying.accepted).toEqual([expect.objectContaining({ item: 'member:contract_exclusion', wrongStep: 'check', by: 'Ops' })]);

  // An answer given for another clause or text does not cover this match.
  expect(evaluate(fields('Obesity', [answer('check', ['6.22@other'])]), ias, [issue]).outcome).toBe('MEMBER_REVIEW_REQUIRED');
});

it('takes "does not apply" or an exception only', () => {
  const options = [{ kind: 'verdict', item: 'member:contract_exclusion', current: false, canFail: false }];
  const body = (wrongStep) => ({ kind: 'verdict', item: 'member:contract_exclusion', passed: true, reason: 'Checked the clause', wrongStep });
  expect(validateCorrection(body('check'), options).error).toBeUndefined();
  expect(validateCorrection(body('exception'), options).error).toBeUndefined();
  expect(validateCorrection(body('reading'), options).error).toMatch(/does not apply/);
});

it('a match let go on never goes STP; "does not apply" keeps STP possible', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: 1000000 }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', lines: [{ benefitType: 'OP', subtotal: 1000 }], diagCode: 'J06.9' };
  expect(evaluateStp(config, { ...input, contractExclusionLetThrough: true })).toMatchObject({ isStp: false, reasons: ['A possible policy contract exclusion was let go on by a person, or was not checked — a person approves.'] });
  expect(evaluateStp(config, input).isStp).toBe(true);
});

it('the summary shows the decision, and a decided match is no longer a review point', () => {
  const flag = { code: 'POSSIBLE_EXCLUSION', ...judgment };
  const summaryWith = (wrongStep) => buildAssessmentSummary({ memberVerifyResult: {
    outcome: 'MEMBER_VERIFIED', checks: { hard: {} }, flags: [flag],
    accepted: [{ item: 'member:contract_exclusion', reason: 'x', by: 'Ops', acceptedReason: 'Diet program', wrongStep }],
  } }).lines.find((l) => l.decision === 'Policy contract exclusion');

  expect(summaryWith('check')).toMatchObject({ result: 'Does not apply (a person checked)', status: 'ok', review: null, confidence: expect.anything() });
  expect(summaryWith('check').why).toContain('Ops: Diet program.');
  expect(summaryWith('exception')).toMatchObject({ result: 'Let go on by a person', status: 'issue', review: null });
  expect(summaryWith('exception').why).toContain('The claim needs approval (never STP).');
});

it('the AI checklist card can stop the case, and a reviewer can mark it or let it go on', () => {
  const card = catalog().checks.find((c) => c.code === 'POSSIBLE_EXCLUSION');
  expect(card).toMatchObject({ effect: 'stops', usesAi: true, locked: false });
  expect(card.reviewerCan).toEqual(['Mark passed', 'Let it go on (with a reason, no STP)']);
  expect(card.ifFails).toContain('The customer is not emailed');
});
