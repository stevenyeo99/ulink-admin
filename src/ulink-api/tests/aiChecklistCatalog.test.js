// The AI checklist page (SYSTEM_5 A): every check code the member check and the document check produce has a catalog
// entry, and "Reviewer can" follows the correction panel's rules.
const fs = require('fs');
const path = require('path');
const checklist = require('../modules/document-checking/checklist');
const { evaluate } = require('../modules/member-verification/checks');
const { CHECKS, SECTIONS, catalog } = require('../modules/ai-checklist/catalog');

const codes = new Set(CHECKS.map((c) => c.code));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'documentChecking');
// A reviewer's own lines (SYSTEM_4 E4-28) are not a system check.
const NOT_A_CHECK = new Set(['PERSON_REQUEST']);

it('every document checklist line code has a catalog entry', () => {
  const seen = new Set();
  for (const file of fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))) {
    const { extractedFields: fields, judgments = {} } = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    const stage1 = checklist.evaluateDocumentChecks(fields);
    const lines = [
      ...stage1.checklist,
      ...checklist.evaluateJudgmentDependentChecks(fields, judgments).checklist,
      ...[checklist.vitaminCheck(fields), checklist.documentListCheck(fields), checklist.benefitTypeCheck(fields), checklist.documentDatesCheck(fields),
        checklist.formatCheck(fields), checklist.fieldsReadCheck(fields, stage1.checklist)].filter(Boolean),
    ];
    lines.forEach((line) => line.code && !NOT_A_CHECK.has(line.code) && seen.add(line.code));
  }
  expect([...seen].filter((code) => !codes.has(code))).toEqual([]);
});

it('every member finding has a catalog entry', () => {
  const fields = { claimant: { claimant_dob: '1990-01-01' }, policy: { policy_no: 'P1' }, claim: { appointment_date: '2026-10-01' },
    bank: { bank_name: 'KBZ', bank_account_name: 'U Aung', bank_account_number: '1' } };
  const ias = { success: true, payload: {
    member: { DOB: '01011980', BANK_NAME: 'CB', CL_PAY_ACCT_NAME: 'Daw Hla', CL_PAY_ACCT_NO: '2' },
    policies: [{ POCY_REF_NO: 'P2' }],
    memberPlans: [{ EFF_DATE: '01012020', EXP_DATE: '12312020' }],
  } };
  const found = evaluate(fields, ias).issues.map((i) => (i.item === 'member:coverage' ? i.reasonCode : i.item));
  expect(found).toEqual(expect.arrayContaining(['COVERAGE_NOT_ACTIVE', 'member:dob', 'member:bank', 'member:policy']));
  expect([evaluate(fields, null).reasonCode, ...found].filter((code) => !codes.has(code))).toEqual([]);
});

// The member check's warnings (possible exclusion, benefit not eligible) come from their own files: a new flag code there
// must have its row too.
it('every member warning flag code has a catalog entry', () => {
  const dir = path.join(__dirname, '..', 'modules', 'member-verification');
  const flagCodes = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]));
  expect(flagCodes).toEqual(expect.arrayContaining(['POSSIBLE_EXCLUSION', 'BENEFIT_NOT_ELIGIBLE']));
  expect(flagCodes.filter((code) => !codes.has(code))).toEqual([]);
});

it('Reviewer can: from the correction rules, with every field named', () => {
  const byCode = Object.fromEntries(catalog().checks.map((c) => [c.code, c]));
  expect(byCode.VOUCHER_AMOUNT_MISMATCH.reviewerCan).toEqual(['Mark passed', 'Mark failed', 'Correct: Voucher amounts, Claimed amount']);
  expect(byCode.PATIENT_NAME_INCONSISTENT.reviewerCan).toEqual(['Mark passed', 'Correct: Claimant name']); // no customer wording
  expect(byCode['member:dob'].reviewerCan).toEqual(['Mark passed', 'Correct: Date of birth']);
  expect(byCode.COVERAGE_NOT_ACTIVE.reviewerCan).toEqual(['Correct: Accident date, Appointment date']); // never marked OK
  expect(byCode.MISSING_MANDATORY_FIELD.reviewerCan[0]).toMatch(/^Correct: /);
  expect(byCode.FIELDS_READ.reviewerCan).toEqual([]);
  // A field key with no label would be dropped without a word.
  for (const check of CHECKS) {
    const named = byCode[check.code].reviewerCan.find((a) => a.startsWith('Correct: '));
    expect(named ? named.split(', ').length : 0).toBe((check.fields || []).length);
  }
});

it('each check sits in a known section, with what happens when it fails', () => {
  const sections = new Set(SECTIONS.map((s) => s.key));
  const byCode = Object.fromEntries(catalog().checks.map((c) => [c.code, c]));
  for (const check of catalog().checks) {
    expect(sections.has(check.section)).toBe(true);
    expect(check.ifFails == null).toBe(check.effect === 'off');
  }
  // The customer's sentence is the checklist's own issue text; a member check never emails the customer.
  expect(byCode.MISSING_VOUCHER.ifFails).toContain('"Missing voucher(s)"');
  expect(byCode.INVOICE_NAME_INCONSISTENT.ifFails).toContain('The patient name on the invoice is not consistent');
  expect(byCode.TREATMENT_DATE_INCONSISTENT.ifFails).toContain('The treatment date is not consistent');
  expect(byCode.MISSING_MANDATORY_FIELD.ifFails).toContain('for example: "Please provide the missing account number."');
  expect(byCode['member:bank'].ifFails).toContain('The customer is not emailed');
});
