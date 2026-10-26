// SYSTEM_5 member exclusion phase B: the exclusion step in the member check — the member:exclusion finding with its
// level, Bypass only (as an exception), the AI answer reused, no STP after a bypass or override. IAS and the AI faked.
jest.mock('../modules/member-verification/iasClient', () => ({ getMemberPolicyEvents: jest.fn(), getMemberLimitBalance: jest.fn(), getMemberInfo: jest.fn() }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));
jest.mock('../modules/ias-claim-preparation/medicalTranslation', () => ({ toEnglishMedicalText: jest.fn(async (t) => ({ ...t, translation: null })) }));

const { getMemberPolicyEvents } = require('../modules/member-verification/iasClient');
const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { checkMemberExclusions } = require('../modules/member-verification/memberExclusion');
const { evaluate } = require('../modules/member-verification/checks');
const { correctionOptions, validateCorrection } = require('../modules/ai-feedback/corrections');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');

const info = { success: true, payload: {
  member: { MBR_NO: 'M1', DOB: '01011990' },
  policies: [{ POCY_NO: 'P1', POCY_REF_NO: 'P-1', EFF_DATE: '08012025', EXP_DATE: '07312026' }],
  memberPlans: [{ EFF_DATE: '08012025', EXP_DATE: '07312026' }],
} };
const fields = (extra = {}) => ({ claim: { appointment_date: '2026-03-01', treatment_outside_myanmar: false }, claimant: { claimant_dob: '1990-01-01' }, medical: { detail_of_illness_injury: 'acid reflux' }, invoices: { items: [] }, ...extra });
const events = (memberEvents, policyEvents = []) => ({ success: true, payload: { memberEvents, policyEvents } });
const GERD = { eventId: '1', eventDate: '2025-08-01', eventDescription: '"1. ASTHMA for 1st yr\n2. Any symptom related to GERD\n3. DRT testing"' };

beforeEach(() => {
  jest.clearAllMocks();
  getMemberPolicyEvents.mockResolvedValue(events([GERD]));
  synthesizeJson.mockResolvedValue({ results: [{ eventId: 'Member:1', applies: true, confidence: 0.92, reason: 'Rule 2 excludes GERD symptoms; the claim is for acid reflux.' }] });
});

it('asks IAS for the period covering the treatment, judges by meaning and raises member:exclusion with the level', async () => {
  const check = await checkMemberExclusions(fields(), info);
  expect(getMemberPolicyEvents).toHaveBeenCalledWith({ policyNo: 'P1', memberNo: 'M1', policyEffDate: '2025-08-01' });
  expect(check.issue).toMatchObject({ item: 'member:exclusion', reasonCode: 'POSSIBLE_MEMBER_EXCLUSION', coverKeys: ['Member:1'] });
  expect(check.issue.reason).toContain('Member exclusion (2025-08-01)');
  expect(check.issue.reason).toContain('acid reflux');
});

it('reuses the last AI answer while the events and the claim are unchanged', async () => {
  const first = await checkMemberExclusions(fields(), info);
  synthesizeJson.mockClear();
  await checkMemberExclusions(fields(), info, first);
  expect(synthesizeJson).not.toHaveBeenCalled();
  await checkMemberExclusions(fields({ medical: { detail_of_illness_injury: 'asthma' } }), info, first); // the claim changed
  expect(synthesizeJson).toHaveBeenCalledTimes(1);
});

it('no exclusions, or IAS cannot answer: nothing stops the case', async () => {
  getMemberPolicyEvents.mockResolvedValueOnce(events([]));
  expect(await checkMemberExclusions(fields(), info)).toMatchObject({ checked: true, issue: null });
  expect(synthesizeJson).not.toHaveBeenCalled();
  getMemberPolicyEvents.mockResolvedValueOnce({ success: false, error: 'Member not found for the specified policy and effective date.' });
  expect(await checkMemberExclusions(fields(), info)).toMatchObject({ checked: false, issue: null, note: expect.stringContaining('Member not found') });
});

it('holds the case at member review; the only action is a bypass as an exception; a new event is a new decision', async () => {
  const { issue } = await checkMemberExclusions(fields(), info);
  const held = evaluate(fields(), info, [issue]);
  expect(held).toMatchObject({ outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'POSSIBLE_MEMBER_EXCLUSION' });
  const option = correctionOptions(fields(), null, held).find((o) => o.item === 'member:exclusion');
  expect(option).toMatchObject({ canFail: false, coverKeys: ['Member:1'] });
  const body = { kind: 'verdict', item: 'member:exclusion', passed: true, reason: 'Reflux is not the excluded GERD' };
  expect(validateCorrection({ ...body, wrongStep: 'check' }, [option]).error).toBe('An exclusion in IAS is bypassed as an exception.');

  const bypass = { kind: 'verdict', item: 'member:exclusion', corrected: true, covers: issue.reason, coverKeys: ['Member:1'], reason: 'ok', by: 'Ops' };
  expect(evaluate(fields({ corrections: [bypass] }), info, [issue]).outcome).toBe('MEMBER_VERIFIED');
  const withPolicy = { ...issue, coverKeys: ['Member:1', 'Policy:7'] };
  expect(evaluate(fields({ corrections: [bypass] }), info, [withPolicy]).outcome).toBe('MEMBER_REVIEW_REQUIRED');
});

it('a let-through exclusion never goes STP; the summary names each event with its level and answer', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: 1000000 }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', lines: [{ benefitType: 'OP', subtotal: 1000 }], diagCode: 'J06.9' };
  expect(evaluateStp(config, { ...input, exclusionLetThrough: true })).toMatchObject({ isStp: false, reasons: ['A possible member or policy exclusion in IAS was let through by a person, or the exclusions could not be checked — a person approves.'] });

  const summary = buildAssessmentSummary({ memberVerifyResult: { outcome: 'MEMBER_VERIFIED', checks: {}, exclusions: { checked: true, events: [
    { key: 'Member:1', level: 'Member', description: 'Any symptom related to GERD', counted: true, match: true, applies: true, reason: 'acid reflux' },
    { key: 'Policy:2', level: 'Policy', description: 'Dental excluded', counted: true, match: false, applies: false, reason: 'not dental' },
  ] } } });
  const lineFor = summary.lines.find((l) => l.decision === 'Exclusions in IAS');
  expect(lineFor).toMatchObject({ result: 'Possible exclusion', status: 'issue' });
  expect(lineFor.why).toContain('Member exclusion: "Any symptom related to GERD" — applies');
  expect(lineFor.why).toContain('Policy exclusion: "Dental excluded" — does not apply');
});
