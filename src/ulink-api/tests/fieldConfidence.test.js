// SYSTEM_4 E3b-2 (E4-08): the AI's evidence for what it read (E3b-1: field_evidence, each voucher's evidence and
// line_total) is used by rules — a check takes the confidence of the values it read; one "Key values read clearly" line
// lists them all (the case page's "What the AI read"); voucher lines that don't add up are a format problem. An unsure
// value is an "AI unsure" review point and holds a passed check with switch #3 — never a missing-document issue.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));

const { Setting } = require('../db/models');
const { getSettings } = require('../modules/settings/settings');
const { evaluateDocumentChecks, fieldsReadCheck, formatCheck } = require('../modules/document-checking/checklist');
const { buildAssessmentSummary } = require('../modules/assessment-summary/summary');
const { unsureDocumentPoints, unsurePassedPoints } = require('../modules/document-checking/holdForReview');

const sure = (field, page = 'claim.pdf - page 1') => ({ field, confidence: 0.95, reason: 'typed on the claim form', page });
const fields = ({ evidence = [], voucher = {} } = {}) => ({
  claimant: { claimant_name: 'Hsu Myat Pyae', claimant_nrc_passport: '12/DAGAYA(N)081441', claimant_dob: '1999-12-07' },
  claim: { appointment_date: '2026-08-14', total_claim_amount: 32500 },
  medical: { detail_of_illness_injury: 'Fever', hospital_or_clinic_name: 'Pun Hlaing' },
  medical_record: { present: true, legible: true, date: '2026-08-14' },
  invoices: { present: true, items: [{ date: '2026-08-14', subtotal: 32500, legible: true, has_clinic_stamp_or_doctor_signature: true,
    evidence: { confidence: 0.9, reason: 'printed receipt', page: 'claim.pdf - page 3' }, line_total: 32500, ...voucher }] },
  bank: { bank_name: 'KBZ', bank_account_name: 'Hsu Myat Pyae', bank_account_number: '123' },
  field_evidence: [sure('claimant.claimant_name'), sure('claim.total_claim_amount'), sure('bank.bank_name'), ...evidence],
});
const item = (f, code) => evaluateDocumentChecks(f).checklist.find((i) => i.code === code);
const summaryOf = (checklist) => buildAssessmentSummary({ documentCheckResult: { passed: true, issues: [], details: [], checklist } });

beforeEach(async () => { Setting.findAll.mockResolvedValue([]); await getSettings(); });

it('a check read from an unsure value is as unsure as that value, and says which', () => {
  const bank = item(fields({ evidence: [{ field: 'bank.bank_account_number', confidence: 0.5, reason: 'handwritten, last digit 1 or 7', page: 'claim.pdf - page 2' }] }), 'MISSING_BANK_INFO');
  expect(bank).toMatchObject({ passed: true, confidence: 0.5 });
  expect(bank.note).toContain('Least sure value read: Account number 50% (handwritten, last digit 1 or 7).');
  expect(summaryOf([bank]).reviewPoints).toEqual([expect.objectContaining({ decision: 'Bank information present', reason: 'AI unsure' })]);
  expect(unsurePassedPoints({ passed: true, checklist: [bank] })).toHaveLength(1);
});

it('voucher checks take the voucher evidence; a check\'s own lower score is kept', () => {
  const amount = item(fields({ voucher: { evidence: { confidence: 0.4, reason: 'amount stamped over', page: 'claim.pdf - page 3' } } }), 'VOUCHER_AMOUNT_MISMATCH');
  expect(amount.confidence).toBe(0.4); // the agreement score (1, amounts match) is no surer than the amounts read

  const dates = item(fields(), 'TREATMENT_DATE_INCONSISTENT');
  expect(dates.confidence).toBe(1); // no evidence for the dates: unchanged
});

it('cases read before E3b (no evidence) are unchanged', () => {
  const old = fields();
  delete old.field_evidence;
  delete old.invoices.items[0].evidence;
  expect(item(old, 'MISSING_BANK_INFO').confidence).toBeNull();
  expect(fieldsReadCheck(old)).toBeNull();
});

it('lists every value read with its evidence; the least sure sets the line\'s confidence', () => {
  const read = fieldsReadCheck(fields({ evidence: [{ field: 'claimant.claimant_nrc_passport', confidence: 0.55, reason: 'handwritten', page: 'claim.pdf - page 1' }] }));
  expect(read).toMatchObject({ code: 'FIELDS_READ', passed: true, confidence: 0.55, reason: '5 values read; least sure: NRC / passport 55%.' });
  expect(read.fields.find((f) => f.field === 'claimant.claimant_nrc_passport')).toMatchObject({ label: 'NRC / passport', value: '12/DAGAYA(N)081441', page: 'claim.pdf - page 1' });
  expect(read.fields.find((f) => f.field === 'voucher 1')).toMatchObject({ label: 'Voucher 1 amount and date', value: '32,500 · 2026-08-14', confidence: 0.9 });
});

it('an unsure value is an "AI unsure" review point naming the value and its page — never a missing-documents finding', () => {
  const read = fieldsReadCheck(fields({ evidence: [{ field: 'claimant.claimant_nrc_passport', confidence: 0.55, reason: 'handwritten', page: 'claim.pdf - page 1' }] }));
  const line = summaryOf([read]).lines.find((l) => l.decision === 'Values read');
  expect(line).toMatchObject({ result: '1 unsure', review: expect.objectContaining({ reason: 'AI unsure' }) });
  expect(line.why).toContain('NRC / passport "12/DAGAYA(N)081441" 55% (handwritten), claim.pdf - page 1');
  expect(unsurePassedPoints({ passed: true, checklist: [read] })).toEqual(['Values read with low confidence: NRC / passport (AI confidence 0.55)']);
  expect(unsureDocumentPoints({ passed: true, checklist: [read] })).toEqual([]);

  const allSure = fieldsReadCheck(fields());
  expect(summaryOf([allSure]).reviewPoints).toEqual([]);
});

it('voucher lines that do not add up to the voucher total are a format problem', () => {
  expect(formatCheck(fields({ voucher: { line_total: 37500 } }), '2026-10-15').problems)
    .toEqual(['Voucher 1 lines add up to 37,500, but its total reads 32,500']);
  expect(formatCheck(fields(), '2026-10-15')).toMatchObject({ problems: [], reason: 'Checked: NRC / passport, dates, amounts, voucher lines.' });
  expect(formatCheck(fields({ voucher: { line_total: null } }), '2026-10-15').problems).toEqual([]);
});

describe('code review 2026-10-15', () => {
  const unsureBank = { field: 'bank.bank_account_number', confidence: 0.5, reason: 'handwritten', page: 'claim.pdf - page 2' };

  it('a failed check stays as the rule decided it — a plainly missing item still goes to the customer', () => {
    const f = fields({ evidence: [{ ...unsureBank, field: 'bank.bank_name' }] });
    f.bank = { bank_name: 'KBZ', bank_account_name: null, bank_account_number: null };
    f.claim.total_claim_amount = 99999; // amount check fails too
    const result = evaluateDocumentChecks(f);
    expect(result.checklist.find((i) => i.code === 'VOUCHER_AMOUNT_MISMATCH')).toMatchObject({ passed: false });
    expect(result.checklist.find((i) => i.code === 'VOUCHER_AMOUNT_MISMATCH').usedFields).toBeUndefined();
    expect(unsureDocumentPoints({ passed: false, checklist: result.checklist.filter((i) => i.code === 'MISSING_BANK_INFO') })).toEqual([]);
  });

  it('a check that had nothing to compare used no value', () => {
    const f = fields({ voucher: { evidence: { confidence: 0.4, reason: 'blurred', page: null } } });
    f.medical_record.date = null;
    expect(item(f, 'TREATMENT_DATE_INCONSISTENT').confidence).toBeNull();
    expect(item(f, 'INVOICE_DATE_INCONSISTENT').confidence).toBeNull();
  });

  it('values read surely leave a rule check a rule result (quietly passed)', () => {
    const bank = item(fields({ evidence: [{ ...unsureBank, confidence: 0.95 }] }), 'MISSING_BANK_INFO');
    expect(bank).toMatchObject({ confidence: null, note: null });
  });

  it('the amount check ignores a refund slip\'s evidence, as it ignores its amount', () => {
    const f = fields();
    f.invoices.items.push({ subtotal: -5250, date: '2026-08-14', evidence: { confidence: 0.4, reason: 'faint', page: null } });
    expect(item(f, 'VOUCHER_AMOUNT_MISMATCH').confidence).toBe(1);
  });

  it('one doubt is one review point: the check that used it reports it, "Values read" does not repeat it', () => {
    const f = fields({ evidence: [unsureBank] });
    const { checklist } = evaluateDocumentChecks(f);
    const read = fieldsReadCheck(f, checklist);
    expect(read.fields.find((e) => e.field === 'bank.bank_account_number')).toMatchObject({ reportedBy: 'MISSING_BANK_INFO' });
    expect(read.confidence).toBe(0.9); // least sure value no check reports: voucher 1
    const points = summaryOf([...checklist, read]).reviewPoints.filter((p) => p.reason === 'AI unsure').map((p) => p.decision);
    expect(points).toEqual(['Bank information present']); // not also "Values read"
  });

  it('a field the AI repeats is kept once (the less sure entry); extra keys in voucher evidence are ignored', () => {
    const f = fields({
      evidence: [{ field: 'claim.total_claim_amount', confidence: 0.5, reason: 'second look', page: null }],
      voucher: { evidence: { confidence: 0.9, reason: 'printed', page: 'p3', value: 'raw', field: 'claim.total_claim_amount' } },
    });
    const read = fieldsReadCheck(f);
    expect(read.fields.filter((e) => e.field === 'claim.total_claim_amount')).toEqual([expect.objectContaining({ confidence: 0.5 })]);
    expect(read.fields.find((e) => e.label === 'Voucher 1 amount and date')).toMatchObject({ field: 'voucher 1', value: '32,500 · 2026-08-14' });
  });
});
