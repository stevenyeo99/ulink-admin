// SYSTEM_4 E4-10: a voucher the AI read vitamins / supplements on is approved by a person (JD3), never STP — with the
// switch "vitamins / supplements: a person approves" (on by default). It is never a document problem: the documents
// still pass. "The AI couldn't tell" is only an unsure review point.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings, DEFAULTS } = require('../modules/settings/settings');
const { vitaminCheck, vitaminRejection } = require('../modules/document-checking/checklist');
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
  expect(vitaminCheck(vouchers(false, null))).toMatchObject({ passed: null, unsureVouchers: [2], note: "The AI couldn't tell for voucher 2 — check its items on the bill." });
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

it('found: one rejection per voucher — its lines added up, one remark naming them (the claimed amount is not changed)', () => {
  const fields = { invoices: { items: [
    { subtotal: 20000, has_vitamin_or_supplement: true, vitamin_items: [{ name: 'Vit C', amount: 10000 }, { name: 'Calcium D', amount: 2500 }, { name: 'Obimin', amount: null }] },
    { subtotal: 5000, has_vitamin_or_supplement: false },
    { subtotal: 3000, has_vitamin_or_supplement: true, vitamin_items: ['Zinc'] }, // an older case: names only
  ] } };
  const line = vitaminCheck(fields);
  expect(line).toMatchObject({ passed: false, vouchers: [1, 3] });
  expect(line.rejections).toEqual([
    { voucher: 1, vitamin_exclude_amount: 12500, vitamin_remark: 'Vit C - 10,000 MMK, Calcium D - 2,500 MMK, Obimin - amount not read is not covered due to supplement.' },
    { voucher: 3, vitamin_exclude_amount: null, vitamin_remark: 'Zinc - amount not read is not covered due to supplement.' },
  ]);
  // The same text is the "why" on the case, in team emails and in the IAS remark.
  expect(summaryOf(line).lines.find((l) => l.decision === 'Vitamins / supplements').why)
    .toContain('Voucher 1: Vit C - 10,000 MMK, Calcium D - 2,500 MMK, Obimin - amount not read is not covered due to supplement.');
  expect(vitaminPoint(summaryOf(line))).toBeDefined();
});

it('the IAS item of a voucher with vitamins gets man_rej set 1; no amount read → no set', () => {
  const { buildPayload } = require('../modules/ias-claim-preparation/payloadBuilder');
  const payload = buildPayload({
    extractedFields: { claim: {}, medical: {}, claimant: {}, policy: {} },
    iasMemberInfoResponse: { payload: { member: {}, memberPlans: [{}] } },
    route: null, diagnosis: null, receivedAt: new Date(), barcode: 'B', isStp: false, docCompleteDate: new Date(),
    lines: [
      { subtotal: 20000, benefit: null, vitamin: vitaminRejection({ has_vitamin_or_supplement: true, vitamin_items: [{ name: 'Vit C', amount: 10000 }] }) },
      { subtotal: 3000, benefit: null, vitamin: vitaminRejection({ has_vitamin_or_supplement: true, vitamin_items: ['Zinc'] }) },
      { subtotal: 5000, benefit: null, vitamin: null },
    ],
  });
  const [first, second, third] = payload.Items;
  expect(first).toMatchObject({
    PresentedAmt: 20000, scma_oid_man_rej_code_1: 'MAN_REJ_CODE_T180', man_rej_amt_1: 10000,
    man_rej_remark_1: 'Vit C - 10,000 MMK is not covered due to supplement.',
  });
  for (const item of [second, third]) expect(Object.keys(item).filter((k) => k.includes('man_rej'))).toEqual([]);
});

it('a "none" the AI was unsure of counts as "could not tell", so a person checks the bill', () => {
  const item = (vitamin_confidence) => ({ invoices: { items: [{ subtotal: 1000, has_vitamin_or_supplement: false, vitamin_confidence }] } });
  expect(vitaminCheck(item(0.4))).toMatchObject({ passed: null, unsureVouchers: [1] });
  expect(vitaminCheck(item(0.95))).toMatchObject({ passed: true });
});

it('the voucher schema asks for each vitamin line with its own amount', () => {
  const { ITEM } = require('../db/migrations/20261016100000-vitamin-item-amounts');
  expect(ITEM).toMatchObject({ required: ['name', 'amount'], properties: { amount: { type: ['number', 'null'] } } });
});

it('vitamin amounts above the voucher amount are a misread: no amount, so JD3 enters it', () => {
  expect(vitaminRejection({ subtotal: 5000, has_vitamin_or_supplement: true, vitamin_items: [{ name: 'Vit C', amount: 50000 }] }))
    .toMatchObject({ vitamin_exclude_amount: null, vitamin_remark: 'Vit C - 50,000 MMK is not covered due to supplement.' });
});
