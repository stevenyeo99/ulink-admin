// AI checklist switches (SYSTEM_5 phase B): a switched-off check is skipped and shows Turned off, never a pass; locked
// checks and information lines cannot be switched; no STP while a check that can stop a case is off (Q2).
jest.mock('../db/models', () => ({ ...jest.requireActual('../db/models'), CheckSwitch: { findAll: jest.fn(async () => []), create: jest.fn(async (row) => row) } }));

const { CheckSwitch } = require('../db/models');
const { setSwitch, withSwitchedOff, switchedOff, offStopping } = require('../modules/ai-checklist/switches');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');
const { evaluate } = require('../modules/member-verification/checks');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');

const row = (code, enabled, at = '2026-10-26T01:00:00Z') => ({ code, enabled, reason: 'Not needed for this product', changedBy: 'Ops', createdAt: at });

beforeEach(() => jest.clearAllMocks());

it('refuses a locked check, an information line, no reason, or the state it already has', async () => {
  expect(await setSwitch('MISSING_VOUCHER', false, 'x x x', 'Ops')).toEqual({ error: 'Is there a voucher? is locked on: it protects the payment.' });
  expect(await setSwitch('member:balance', false, 'x x x', 'Ops')).toMatchObject({ error: expect.stringContaining('locked on') });
  expect((await setSwitch('FIELDS_READ', false, 'x x x', 'Ops')).error).toMatch(/cannot be switched/);
  expect((await setSwitch('UNCLEAR_VOUCHER', false, '', 'Ops')).error).toBe('Add a reason for the change.');
  expect((await setSwitch('UNCLEAR_VOUCHER', true, 'x x x', 'Ops')).error).toBe('The check is already on.');
  expect(CheckSwitch.create).not.toHaveBeenCalled();
  expect(await setSwitch('UNCLEAR_VOUCHER', false, 'Not needed', 'Ops')).toMatchObject({ code: 'UNCLEAR_VOUCHER', enabled: false });
});

it('the latest row decides; a locked check never counts as off', async () => {
  CheckSwitch.findAll.mockResolvedValue([row('UNCLEAR_VOUCHER', false), row('UNCLEAR_VOUCHER', true, '2026-10-26T02:00:00Z'), row('member:dob', false), row('MISSING_VOUCHER', false)]);
  expect([...(await switchedOff()).keys()]).toEqual(['member:dob']);
});

it('a switched-off document check: its issues go, its line shows Turned off (never a pass), passed is worked out again', () => {
  const fixture = require('./fixtures/documentChecking/missing-mandatory-fields.json');
  const result = evaluateDocumentChecks(fixture.extractedFields);
  expect(result.passed).toBe(false);
  const off = new Map([['MISSING_MANDATORY_FIELD', row('MISSING_MANDATORY_FIELD', false)]]);
  const after = withSwitchedOff(result, off);
  expect(after.issues.filter((i) => i.startsWith('Please provide the missing'))).toEqual([]);
  const line = after.checklist.find((l) => l.code === 'MISSING_MANDATORY_FIELD');
  expect(line).toMatchObject({ passed: null, turnedOff: true, note: 'Turned off by Ops on 2026-10-26: Not needed for this product' });
  expect(after.passed).toBe(after.issues.length === 0);
});

it('a switched-off member check is dropped from the findings', () => {
  const fields = { claim: { appointment_date: '2026-09-01' }, claimant: { claimant_dob: '1980-01-01' }, policy: { policy_no: 'P1' } };
  const ias = { success: true, payload: { member: { DOB: '01011990' }, policies: [{ POCY_REF_NO: 'P1' }], memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '01012030' }] } };
  expect(evaluate(fields, ias).reasonCode).toBe('MEMBER_DETAILS_MISMATCH');
  expect(evaluate(fields, ias, [], new Map([['member:dob', row('member:dob', false)]])).outcome).toBe('MEMBER_VERIFIED');
});

it("STP reads the case's own record: what was turned off when it was checked, only checks that could stop a case", () => {
  const { caseChecksOff } = require('../modules/ai-checklist/switches');
  const member = { turnedOff: [{ code: 'member:dob' }, { code: 'POSSIBLE_EXCLUSION' }] };
  const documents = { checklist: [{ code: 'UNCLEAR_VOUCHER', turnedOff: true }, { code: 'MISSING_VOUCHER', passed: true }] };
  expect(caseChecksOff(member, documents)).toEqual(['member:dob', 'UNCLEAR_VOUCHER']);
  expect(caseChecksOff(null, null)).toEqual([]);
});

it('the summary names a turned-off document check, never "nothing to compare"', () => {
  const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
  const summary = buildAssessmentSummary({ documentCheckResult: { passed: true, issues: [], checklist: [{ code: 'UNCLEAR_VOUCHER', label: 'Unclear voucher(s)', passed: null, turnedOff: true, note: 'Turned off by Ops on 2026-10-26: x' }] } });
  expect(summary.lines.find((l) => l.result === 'Turned off')).toMatchObject({ status: 'not_checked', why: 'Turned off by Ops on 2026-10-26: x' });
});

it('no STP while a check that can stop a case is off; a warning switched off does not block', () => {
  const config = { rules: [{ caseSource: 'EMAIL', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: 1000000 }], blockedDiagnoses: [] };
  const input = { source: 'EMAIL', currency: 'MMK', lines: [{ benefitType: 'OP', subtotal: 1000 }], diagCode: 'J06.9' };
  const off = new Map([['UNCLEAR_VOUCHER', row('UNCLEAR_VOUCHER', false)], ['POSSIBLE_EXCLUSION', row('POSSIBLE_EXCLUSION', false)]]);
  expect(offStopping(off)).toEqual(['UNCLEAR_VOUCHER']);
  expect(evaluateStp(config, { ...input, checksOff: offStopping(off) })).toMatchObject({ isStp: false, reasons: ['A check is switched off (UNCLEAR_VOUCHER) — a person approves.'] });
  expect(evaluateStp(config, input).isStp).toBe(true);
});
