// SYSTEM_4 D3: the AI baseline from stored case results — per checklist item how often it fails and how often the AI
// is unsure (at or below the threshold), review points, STP rate and reasons, diagnosis fallbacks, overrides. Pure.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { getSettings } = require('../modules/settings/settings');
const { baselineFrom, baselineMarkdown } = require('../modules/llm-calls/baseline');

const item = (code, passed, confidence) => ({ code, label: code, passed, confidence });
const cases = [
  {
    source: 'API', currentStatus: 'API_CSR_SENT', isStp: true,
    documentCheckResult: { passed: true, issues: [], details: [], checklist: [item('PATIENT_NAME_INCONSISTENT', true, 0.95), item('MISSING_VOUCHER', true, 0.6)] },
    claimPrepMeta: { diagnosis: { confidence: 0.9, defaulted: false }, lines: [{ confidence: 0.8 }], stp: { reasons: [], benefits: [] } },
  },
  {
    source: 'EMAIL', currentStatus: 'CLAIM_CREATED', isStp: false,
    documentCheckResult: { passed: false, issues: ['x'], details: [], checklist: [item('PATIENT_NAME_INCONSISTENT', false, 0.4), item('MISSING_VOUCHER', null, null)] },
    memberVerifyResult: { outcome: 'MEMBER_VERIFIED' },
    claimPrepMeta: { diagnosis: { confidence: 0.3, defaulted: true }, lines: [{ confidence: 0.5 }], stp: { reasons: ['OP 120,000 MMK > limit 100,000.'], benefits: [] } },
    events: [{ reasonCode: 'MANUAL_OVERRIDE', prevStatus: 'INCOMPLETE' }],
  },
];

beforeAll(() => getSettings());

it('counts per checklist item: evaluated, failed, average confidence, unsure share', () => {
  const b = baselineFrom(cases, 0.7);
  expect(b.checklist.find((c) => c.code === 'PATIENT_NAME_INCONSISTENT')).toMatchObject({ evaluated: 2, failedShare: 0.5, scored: 2, avgConfidence: 0.675, unsureShare: 0.5 });
  expect(b.checklist.find((c) => c.code === 'MISSING_VOUCHER')).toMatchObject({ evaluated: 1, scored: 1, unsureShare: 1 }); // "not checked" left out
});

it('counts sources, groups, STP, diagnosis fallbacks, benefit confidence, overrides', () => {
  const b = baselineFrom(cases, 0.7);
  expect(b).toMatchObject({ cases: 2, bySource: { API: 1, EMAIL: 1 }, byGroup: { done: 2 } });
  expect(b.stp).toMatchObject({ prepared: 2, stp: 1, reasons: [['OP N MMK > limit N', 1]] });
  expect(b.diagnosis).toMatchObject({ picked: 2, defaulted: 1, avgConfidence: 0.6 });
  expect(b.benefit).toMatchObject({ scored: 2, unsureShare: 0.5 });
  expect(b.overridesByArea).toEqual({ documents: 1 });
  expect(b.review.summarized).toBe(2);
});

it('writes a readable report', () => {
  const md = baselineMarkdown(baselineFrom(cases, 0.7), { date: '2026-10-14', database: 'test' });
  expect(md).toContain('# AI baseline — 2026-10-14');
  expect(md).toContain('1 of 2 prepared claims went STP (50%)');
  expect(md).toContain('| PATIENT_NAME_INCONSISTENT | 2 | 50% | 2 | 68% | 50% |');
});
