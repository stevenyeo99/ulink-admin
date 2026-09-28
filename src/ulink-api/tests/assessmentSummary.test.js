// assessment-summary: the explanation trail built from a case's stored results — one line per decision
// with why / confidence / how verified, and review points for what a person should look at.

const { buildAssessmentSummary, assessmentSummaryText } = require('../modules/assessment-summary/summary');

const verifiedMember = {
  outcome: 'MEMBER_VERIFIED',
  reasonCode: null,
  reason: null,
  checks: { hard: { coverageActive: true, dobMatch: true, bankNameMatch: true, bankAccountNameMatch: true, bankAccountNumberMatch: true, policyNoMatch: null } },
  flags: [],
};

const completeDocuments = {
  passed: true,
  issues: [],
  details: [],
  checklist: [
    { code: 'MISSING_MANDATORY_FIELD', label: 'Submission Information: Case Number', passed: true },
    { code: 'MISSING_VOUCHER', label: 'Missing voucher(s)', passed: true, confidence: 1, note: 'Invoice on page 6.' },
    { code: 'VOUCHER_AMOUNT_MISMATCH', label: 'The amount …', passed: true, confidence: 1, note: 'Voucher total (145,000) matches.' },
    { code: 'UNCLEAR_VOUCHER', label: 'Unclear voucher(s)', passed: true, confidence: null, note: null },
    { code: 'PROVIDER_NAME_INCONSISTENT', label: 'The doctor name … does not appear to match …', passed: null, confidence: null, note: null },
  ],
};

const confidentPrep = {
  diagnosis: { pick: { diagCode: 'Z09.9', diagDesc: 'Follow-up examination' }, defaulted: false, confidence: 0.9 },
  lines: [{ pick: { benefitType: 'OP', benefitHead: 'OV' }, confidence: 0.9, voucherType: 'consultation' }],
};

const find = (summary, decision) => summary.lines.find((l) => l.decision === decision);

it('explains a complete, confident case with no review points', () => {
  const summary = buildAssessmentSummary({ memberVerifyResult: verifiedMember, documentCheckResult: completeDocuments, claimPrepMeta: confidentPrep, isStp: false });

  expect(find(summary, 'Member check')).toMatchObject({ result: 'Verified', verified: 'Cross-checked' });
  expect(find(summary, 'Member check').why).toContain('date of birth');
  expect(find(summary, 'Voucher amount matches claimed amount')).toMatchObject({ verified: 'Cross-checked', confidence: '1.00' });
  expect(find(summary, 'Voucher present')).toMatchObject({ verified: 'AI self-rated', why: 'Invoice on page 6.' });
  // Quiet passes and nothing-to-compare checks collapse into one line each.
  expect(find(summary, 'Other document checks').why).toContain('Voucher readable');
  expect(find(summary, 'Not checked').why).toContain('Doctor name matches medical record');
  // Reasons not stored yet say so instead of inventing one.
  expect(find(summary, 'Diagnosis code').why).toBe('Reason not recorded');
  expect(find(summary, 'STP')).toMatchObject({ result: 'No', why: 'Reason not recorded' });
  expect(summary.needsReview).toBe(false);
  expect(assessmentSummaryText(summary)).toContain('No review points.');
});

it('explains missing and unreadable documents in plain words, with who might be wrong', () => {
  const summary = buildAssessmentSummary({
    documentCheckResult: {
      passed: false,
      details: [{ code: 'INCOMPLETE_MEDICAL_REPORT', reason: 'medical_record.present is true but medical_record.legible is false.' }],
      checklist: [
        { code: 'MISSING_MANDATORY_FIELD', label: 'Submission Information: Case Number', passed: false },
        { code: 'INCOMPLETE_MEDICAL_REPORT', label: 'Incomplete medical report(s)', passed: false, confidence: null, note: null },
      ],
    },
  });

  expect(find(summary, 'Mandatory fields')).toMatchObject({ result: '1 missing', review: { reason: 'Missing information', mightBeWrong: ['Customer', 'AI vision'] } });
  expect(find(summary, 'Medical record readable')).toMatchObject({
    status: 'issue',
    why: 'A medical record was found but could not be read clearly.',
    review: { reason: 'Unreadable', mightBeWrong: ['AI vision', 'Customer'] },
  });
  expect(summary.reviewPoints.map((p) => p.reason)).toEqual(['Missing information', 'Unreadable']);
});

it('explains a member issue as a data mismatch, with the values compared', () => {
  const summary = buildAssessmentSummary({
    memberVerifyResult: {
      outcome: 'MEMBER_REVIEW_REQUIRED',
      reasonCode: 'BANK_DETAILS_MISMATCH',
      reason: 'Bank details do not match IAS record: account number ("123" vs IAS "456").',
      flags: [],
    },
  });

  expect(find(summary, 'Member check')).toMatchObject({
    result: 'BANK_DETAILS_MISMATCH',
    status: 'issue',
    why: expect.stringContaining('"123" vs IAS "456"'),
    review: { reason: 'Data mismatch', mightBeWrong: ['Customer', 'AI vision', 'IAS record'] },
  });
});

it('flags low confidence and a defaulted diagnosis as AI unsure, and an STP claim with open points first', () => {
  const summary = buildAssessmentSummary({
    documentCheckResult: { checklist: [{ code: 'NO_MEDICAL_REPORT', label: 'No Medical Report(s)', passed: true, confidence: 0.3, note: 'Maybe page 2.' }] },
    claimPrepMeta: {
      diagnosis: { pick: { diagCode: 'R69', diagDesc: 'Unknown' }, defaulted: true, confidence: 0 },
      lines: [{ pick: null, confidence: 0.2 }],
    },
    isStp: true,
  });

  expect(find(summary, 'Medical record present')).toMatchObject({ status: 'ok', review: { reason: 'AI unsure' } });
  expect(find(summary, 'Diagnosis code')).toMatchObject({ result: 'R69 Unknown (default)', status: 'issue', review: { reason: 'AI unsure' } });
  expect(find(summary, 'Benefit (voucher 1)')).toMatchObject({ result: 'None', review: { reason: 'AI unsure' } });
  expect(summary.reviewPoints[0]).toMatchObject({ decision: 'STP', reason: 'STP with open review points' });
});

it('uses the STP numbers and a decision reason once they are stored', () => {
  const summary = buildAssessmentSummary({
    claimPrepMeta: { diagnosis: { pick: { diagCode: 'Z09.9' }, defaulted: false, confidence: 0.9, reason: 'Record says follow-up visit.' }, stp: { total: 145000, limit: 300000, currency: 'MMK' } },
    isStp: true,
  });

  expect(find(summary, 'Diagnosis code').why).toBe('Record says follow-up visit.');

  // A default / no pick keeps the AI's own reason too — that is what a reviewer needs to judge it.
  const unsure = buildAssessmentSummary({
    claimPrepMeta: {
      diagnosis: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0.2, reason: 'Text only names a procedure.' },
      lines: [{ pick: null, confidence: 0.1, reason: 'Voucher type unreadable.' }],
    },
  });
  expect(find(unsure, 'Diagnosis code').why).toBe('No confident match for the diagnosis text, so the default code was used. AI: Text only names a procedure.');
  expect(find(unsure, 'Benefit (voucher 1)').why).toBe('No benefit could be picked with enough confidence. AI: Voucher type unreadable.');
  expect(find(summary, 'STP').why).toBe('Claimed 145,000 MMK ≤ limit 300,000');

  const noLimit = buildAssessmentSummary({ claimPrepMeta: { stp: { total: 145000, limit: null, currency: 'MMK' } }, isStp: false });
  expect(find(noLimit, 'STP').why).toBe('No STP limit is configured for this claim type in MMK, so it is not STP.');
});

it('handles a case with no results yet', () => {
  const summary = buildAssessmentSummary({});
  expect(summary).toEqual({ lines: [], reviewPoints: [], needsReview: false });
  expect(assessmentSummaryText(summary)).toBe('No assessment yet.');
  expect(buildAssessmentSummary()).toEqual({ lines: [], reviewPoints: [], needsReview: false });
});

it('shows a diagnosis that was translated from Burmese, and marks it as AI translated', () => {
  const summary = buildAssessmentSummary({
    claimPrepMeta: {
      diagnosis: {
        pick: { diagCode: 'R22.1', diagDesc: 'Localized swelling, mass and lump, neck' },
        defaulted: false,
        confidence: 0.7,
        reason: 'Text describes a neck lump.',
        text: 'Diagnosis/illness: Neck lump, for ultrasound examination',
        translation: { original: { diagnosis: 'လည်ပင်း', treatment: null }, confidence: 0.7, note: null },
      },
    },
  });
  expect(find(summary, 'Diagnosis code')).toMatchObject({
    why: 'Translated from Burmese as: "Diagnosis/illness: Neck lump, for ultrasound examination". Text describes a neck lump.',
    verified: 'AI self-rated, AI translated',
  });
});

it('marks the points of a check a person overrode as handled, keeping them visible', () => {
  const fields = {
    memberVerifyResult: { outcome: 'MEMBER_REVIEW_REQUIRED', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x' },
    claimPrepMeta: { diagnosis: { pick: { diagCode: 'R69' }, defaulted: true, confidence: 0 } },
  };
  const note = "Overridden by Ulink (ulink) — The customer's details were confirmed: phoned.";
  const summary = buildAssessmentSummary(fields, { overrides: [{ area: 'member', at: '2026-09-28T07:00:00Z', note }] });

  expect(find(summary, 'Member check').overridden).toEqual({ at: '2026-09-28T07:00:00Z', note });
  expect(summary.reviewPoints.find((p) => p.decision === 'Member check').overridden.note).toBe(note);
  // the diagnosis point (another check) stays open
  expect(summary.reviewPoints.find((p) => p.decision === 'Diagnosis code').overridden).toBeUndefined();
  expect(summary.needsReview).toBe(true);
  expect(assessmentSummaryText(summary)).toContain(`Member check — already handled — ${note}`);

  // nothing left open once the only point is handled
  const handled = buildAssessmentSummary({ memberVerifyResult: fields.memberVerifyResult }, { overrides: [{ area: 'member', at: null, note }] });
  expect(handled.needsReview).toBe(false);
});
