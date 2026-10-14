// SYSTEM_4 E4-10: a voucher the AI read vitamins / supplements on is approved by a person (JD3), never STP — with the
// switch "vitamins / supplements: a person approves" (on by default). It is never a document problem: the documents
// still pass. "The AI couldn't tell" is only an unsure review point.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings, DEFAULTS } = require('../modules/settings/settings');
const { vitaminCheck } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { evaluateStp } = require('../modules/ias-claim-preparation/stpEligibility');
const { unsureDocumentPoints, unsurePassedPoints } = require('../modules/document-checking/holdForReview');

const vouchers = (...flags) => ({ invoices: { items: flags.map((v) => ({ subtotal: 1000, has_vitamin_or_supplement: v })) } });
const summaryOf = (item) => buildAssessmentSummary({ documentCheckResult: { passed: true, issues: [], details: [], checklist: [item] } });
const vitaminPoint = (summary) => summary.reviewPoints.find((p) => p.decision === 'Vitamins / supplements');

beforeEach(async () => { Setting.findAll.mockResolvedValue([]); await getSettings(); });

it('is on by default', () => {
  expect(DEFAULTS.vitaminsBlockStp).toBe(true);
});

it('reads the vouchers into one checklist line: found, none, or the AI could not tell', () => {
  expect(vitaminCheck(vouchers(false, true))).toMatchObject({ code: 'VITAMIN_OR_SUPPLEMENT', passed: false, vouchers: [2], note: 'Vitamins / supplements on voucher 2.' });
  expect(vitaminCheck(vouchers(false, false))).toMatchObject({ passed: true, vouchers: [], note: null });
  expect(vitaminCheck(vouchers(false, null))).toMatchObject({ passed: null, unsureVouchers: [2], note: "The AI couldn't tell for voucher 2." });
  expect(vitaminCheck({ invoices: { items: [] } })).toBeNull();
});

it('is never a missing-document finding, nor an unsure pass that stops the case', () => {
  const result = { passed: true, checklist: [vitaminCheck(vouchers(true))] };
  expect(unsureDocumentPoints(result)).toEqual([]);
  expect(unsurePassedPoints(result)).toEqual([]);
});

it('found: a review point saying which voucher, and no STP', () => {
  const point = vitaminPoint(summaryOf(vitaminCheck(vouchers(false, true))));
  expect(point).toMatchObject({ reason: 'Vitamins / supplements' });

  const config = { rules: [{ caseSource: 'API', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: '100000' }], blockedDiagnoses: [], blockVitamins: true };
  const input = { source: 'API', currency: 'MMK', diagCode: 'J06.9', lines: [{ benefitType: 'OP', subtotal: 32500 }], vitaminVouchers: [2] };
  expect(evaluateStp(config, input)).toMatchObject({ isStp: false, reasons: ['Vitamins / supplements on voucher 2 — a person approves.'] });
  expect(evaluateStp(config, { ...input, vitaminVouchers: [] }).isStp).toBe(true);
  expect(evaluateStp({ ...config, blockVitamins: false }, input).isStp).toBe(true);
});

it('switch off: shown on the case, but no review point', async () => {
  Setting.findAll.mockResolvedValue([{ key: 'vitaminsBlockStp', value: false }]);
  await getSettings();
  expect(vitaminPoint(summaryOf(vitaminCheck(vouchers(true))))).toBeUndefined();
});

it('the AI could not tell: an "AI unsure" point only — it does not block STP by itself', () => {
  expect(vitaminPoint(summaryOf(vitaminCheck(vouchers(null))))).toMatchObject({ reason: 'AI unsure' });
});
