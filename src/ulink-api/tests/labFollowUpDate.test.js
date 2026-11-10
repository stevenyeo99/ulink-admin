// The doctor's follow-up period (users, 2026-11-10, UAT AYA-CL-26021418): a lab / imaging voucher dated after the visit
// passes the date check when the doctor's note gives a period and the voucher is inside it, with everything read
// surely. Anything else still fails, and a person decides. The note is read only when the rule can use it.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));

const { getSettings } = require('../modules/settings/settings');
const { evaluateDocumentChecks } = require('../modules/document-checking/checklist');
const { followUpDate } = require('../modules/document-checking/labFollowUp');
const { readDoctorFollowUp } = require('../modules/claim-recognition/doctorFollowUp');
const { correctionOptions, validateCorrection } = require('../modules/ai-feedback/corrections');

// A visit on 1 June with "review after 1 week"; the customer wrote the day of the test on the claim form.
const fields = ({ voucher = {}, record = {}, claimDate } = {}) => {
  const item = {
    subtotal: 36750, legible: true, has_clinic_stamp_or_doctor_signature: true, voucher_type: 'lab', date: '2026-06-05',
    evidence: { confidence: 0.9, reason: 'printed', page: 'c.pdf - page 5' }, doctor_fee: { found: false, confidence: 0.9 }, ...voucher,
  };
  return {
    claim: { appointment_date: claimDate ?? item.date, total_claim_amount: 36750 },
    medical: { detail_of_illness_injury: 'Overweight', hospital_or_clinic_name: 'Aryu' },
    medical_record: {
      present: true, legible: true, date: '2026-06-01', doctor_note: 'Ix: CBC. Review after 1 week', follow_up: '1 week',
      follow_up_evidence: { confidence: 0.9, reason: "'Review after 1 week'", page: 'c.pdf - page 3' }, ...record,
    },
    invoices: { present: true, items: [item] },
    bank: { bank_name: 'KBZ', bank_account_name: 'me me win pe', bank_account_number: '12730102104946001' },
    field_evidence: [{ field: 'medical_record.date', confidence: 0.9, reason: 'printed', page: 'c.pdf - page 3' }],
  };
};
const dateLines = (f) => {
  const result = evaluateDocumentChecks(f);
  const line = (code) => result.checklist.find((i) => i.code === code);
  return { claim: line('TREATMENT_DATE_INCONSISTENT'), voucher: line('INVOICE_DATE_INCONSISTENT'), flags: result.flags.map((flag) => flag.code).filter((code) => code.endsWith('DATE_INCONSISTENT')) };
};

beforeEach(async () => { await getSettings(); });

it('adds the period to the visit date (a month is a calendar month)', () => {
  expect(followUpDate('2026-06-01', '1 week')).toBe('2026-06-08');
  expect(followUpDate('2026-06-01', '3 days')).toBe('2026-06-04');
  expect(followUpDate('2026-01-31', '1 month')).toBe('2026-02-28');
  expect(followUpDate('2026-06-01', 'soon')).toBeNull();
});

it('a lab voucher inside the follow-up passes both date checks, and names the evidence', () => {
  const { claim, voucher, flags } = dateLines(fields());
  expect(flags).toEqual([]);
  expect(voucher).toMatchObject({ passed: true, confidence: 1 });
  expect(voucher.note).toBe('Voucher 1 (lab, 2026-06-05) is within the doctor\'s follow-up of 1 week from the visit on 2026-06-01 (until 2026-06-08, read on c.pdf - page 3). Doctor\'s note: "Ix: CBC. Review after 1 week".');
  expect(claim).toMatchObject({ passed: true, confidence: 1 });
  expect(claim.note).toMatch(/Claim date \(2026-06-05\) is the date of voucher 1, a lab test within the doctor's follow-up of 1 week/);
  expect(dateLines(fields({ voucher: { date: '2026-06-08' } })).voucher.passed).toBe(true); // the last day counts
});

it('a claim date that is not the date of that voucher still fails its own check', () => {
  const { claim, voucher } = dateLines(fields({ claimDate: '2026-06-03' }));
  expect(voucher.passed).toBe(true);
  expect(claim.passed).toBe(false);
});

it('fails, with the reason, one day after the follow-up, before the visit, or with no period', () => {
  const late = dateLines(fields({ voucher: { date: '2026-06-09' } }));
  expect(late.flags).toEqual(['TREATMENT_DATE_INCONSISTENT', 'INVOICE_DATE_INCONSISTENT']);
  expect(late.voucher.note).toContain("The doctor's follow-up is 1 week from the visit on 2026-06-01 (until 2026-06-08); voucher 1 (lab) is dated 2026-06-09, after it.");
  expect(dateLines(fields({ voucher: { date: '2026-05-30' } })).voucher).toMatchObject({ passed: false, note: expect.stringContaining('dated before the visit') });
  expect(dateLines(fields({ record: { follow_up: null, follow_up_evidence: null } })).voucher).toMatchObject({ passed: false, note: expect.stringContaining('gives no follow-up period') });
});

it('fails when anything the pass rests on is not sure', () => {
  const unsure = [
    fields({ record: { follow_up_evidence: { confidence: 0.3, reason: "'ပတ်' = week, handwritten", page: null } } }), // Burmese handwriting, guessed
    fields({ voucher: { evidence: { confidence: 0.3 } } }),
    fields({ voucher: { doctor_fee: { found: true, confidence: 0.9 } } }),
    fields({ voucher: { doctor_fee: undefined } }),
    { ...fields(), field_evidence: [] }, // no score for the medical record date
  ];
  for (const f of unsure) expect(dateLines(f).voucher).toMatchObject({ passed: false, note: expect.stringContaining('the AI was not sure of') });
});

it('shows the follow-up on the line when another voucher simply matches the record date', () => {
  const two = fields({ claimDate: '2026-06-01' });
  two.invoices.items.unshift({ subtotal: 5000, legible: true, voucher_type: 'consultation', date: '2026-06-01', evidence: { confidence: 0.9 } });
  expect(dateLines(two).voucher).toMatchObject({ passed: true, note: expect.stringContaining("Voucher 2 (lab, 2026-06-05) is within the doctor's follow-up of 1 week") });
});

it('a follow-up longer than 90 days, or read for another visit date, is for a person', () => {
  const long = dateLines(fields({ voucher: { date: '2026-10-01' }, record: { follow_up: '6 months' } })).voucher;
  expect(long).toMatchObject({ passed: false, note: expect.stringContaining('longer than 90 days') });
  // A reviewer corrected the medical record date after the AI read the note for the visit on 10 June.
  const moved = fields({ record: { follow_up_evidence: { confidence: 0.9, reason: null, page: null, recordDate: '2026-06-10' } } });
  expect(dateLines(moved).voucher).toMatchObject({ passed: false, note: expect.stringContaining('read for the visit on 2026-06-10') });
});

it("a person's period passes without the AI's doctor-fee answer (an older case, or a failed read)", () => {
  const old = fields({ voucher: { doctor_fee: undefined }, record: { doctor_note: undefined, follow_up_evidence: undefined } });
  old.field_evidence.push({ field: 'medical_record.follow_up', confidence: 1, reason: 'Corrected by may: the note says review after 1 week', page: null });
  expect(dateLines(old).voucher.passed).toBe(true);
});

it('is only for a lab voucher: a pharmacy or consultation voucher with the same period fails as before', () => {
  for (const type of ['pharmacy', 'consultation', 'other']) {
    const { voucher, claim } = dateLines(fields({ voucher: { voucher_type: type } }));
    expect(voucher.passed).toBe(false);
    expect(claim.passed).toBe(false);
    expect(voucher.note).not.toMatch(/doctor's follow-up/);
  }
});

describe('reading the note', () => {
  const read = { ...fields(), medical_record: { present: true, legible: true, date: '2026-06-01' } };
  delete read.invoices.items[0].doctor_fee;

  it('asks only when a lab voucher is off the medical record date', async () => {
    const ask = jest.fn();
    for (const voucher of [{ date: '2026-06-01' }, { voucher_type: 'pharmacy' }, { voucher_type: 'consultation' }]) {
      const same = fields({ voucher });
      expect(await readDoctorFollowUp(same, ['[c.pdf - page 1]\nx'], ask)).toBe(same);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it('keeps the note as written and the period in the fixed form (a Burmese note → "1 week")', async () => {
    const ask = jest.fn(async () => ({
      doctor_note: ' Plan: CBC, နောက်တစ်ပတ် ပြန်ပြရန် ', follow_up_reason: "'နောက်တစ်ပတ်' = next week", follow_up: '1 Week', follow_up_confidence: 0.8,
      follow_up_page: 'c.pdf - page 3', vouchers: [{ voucher: 1, has_consultation_or_doctor_fee: false, confidence: 0.95 }],
    }));
    const out = await readDoctorFollowUp(read, ['[c.pdf - page 3]\nPlan'], ask);
    expect(ask.mock.calls[0][0].userText).toContain('Medical record date: 2026-06-01\nLab / imaging vouchers to look at:\n- Voucher 1: dated 2026-06-05, amount 36750, on c.pdf - page 5');
    expect(out.medical_record).toMatchObject({
      doctor_note: 'Plan: CBC, နောက်တစ်ပတ် ပြန်ပြရန်', follow_up: '1 week',
      follow_up_evidence: { confidence: 0.8, reason: "'နောက်တစ်ပတ်' = next week", page: 'c.pdf - page 3', recordDate: '2026-06-01' },
    });
    expect(out.invoices.items[0].doctor_fee).toEqual({ found: false, confidence: 0.95 });
    expect(dateLines(out).voucher.passed).toBe(true);
  });

  it('a period not in the fixed form is no period, and a failed call changes nothing', async () => {
    const vague = await readDoctorFollowUp(read, [], async () => ({ doctor_note: 'come back soon', follow_up_reason: null, follow_up: 'soon', follow_up_confidence: 0.9, follow_up_page: 'p', vouchers: [] }));
    expect(vague.medical_record).toMatchObject({ follow_up: null, follow_up_evidence: { confidence: null, reason: 'not a period: "soon"', page: null, recordDate: '2026-06-01' } });
    expect(vague.invoices.items[0].doctor_fee).toEqual({ found: null, confidence: null });
    expect(dateLines(vague).voucher.passed).toBe(false);
    expect(await readDoctorFollowUp(read, [], async () => { throw new Error('timeout'); })).toBe(read);
  });
});

it('a reviewer corrects the period in the fixed form only, and the corrected period counts as sure', () => {
  const unsure = fields({ record: { follow_up: '2 days', follow_up_evidence: { confidence: 0.3, reason: null, page: null } } });
  const body = { kind: 'value', item: 'medical_record.follow_up', wrongStep: 'reading', reason: 'The note says review after one week, not two days.' };
  const options = correctionOptions(unsure);
  expect(validateCorrection({ ...body, value: 'soon' }, options).error).toBe('Follow-up period: enter a number and day, week or month, e.g. 2 weeks.');
  expect(validateCorrection({ ...body, value: ' 1 Week ' }, options).corrected).toBe('1 week');
  expect(evaluateDocumentChecks(unsure).checklist.find((i) => i.code === 'INVOICE_DATE_INCONSISTENT').editItems).toContain('medical_record.follow_up');
});
