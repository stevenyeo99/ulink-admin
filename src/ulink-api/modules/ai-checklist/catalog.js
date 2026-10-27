const { ISSUES, FIELD_LABELS, JUDGMENT_CHECKLIST_LABELS, issueForFlag } = require('../document-checking/checklist');
const { MEMBER_ITEM_LABELS, ACCEPTABLE_MEMBER_ITEMS } = require('../member-verification/checks');
const { NOT_VERDICT_ITEMS } = require('../ai-feedback/corrections');

// The AI checklist page (SYSTEM_5 phase A, docs/imp/CR/SYSTEM_5/PRD/SYSTEM_5_PRD.md): every check the member check and
// the document check run, in plain words, for the owner, ULINK staff and developers. One entry per check code;
// tests/aiChecklistCatalog.test.js fails when a check produces a code that is not here.
//
// Written here: section (which paper it looks at, in the order the system runs), question (the check as a plain
// question), does, effect, usesAi (not shown on the page: owner, 2026-10-26), locked, fields, and onFail where the
// general "If it fails" text is not true. Read from the code, so the page cannot drift: label (the line's name
// on the case page), ifFails (the customer's sentence comes from the checklist's own issue text) and reviewerCan (from
// the correction panel's rules, ai-feedback/corrections.js).
//
// effect: 'stops' (a document check: the case is incomplete and the customer is asked; a member check: the case waits
// for a person), 'warning' (shown to the reviewer or the approver, never stops the case), 'info' (shown only), 'off'
// (in the code but not run). fields: the values a reviewer can correct that this check reads (FIELD_LABELS keys, or a
// VOUCHER_FIELDS key). locked: may never be switched off (phase B, PRD 4.5 — the owner confirms the list, Q1).

// In the order the system runs: the member check first, then the document check by paper, then what the AI read.
const SECTIONS = [
  { key: 'member', group: 'member', title: 'Member and policy (IAS)', intro: "The claim against the member's record in IAS." },
  { key: 'claimForm', group: 'document', title: 'Claim form', intro: 'What the claim form must give.' },
  { key: 'vouchers', group: 'document', title: 'Vouchers (invoices and receipts)', intro: 'What each voucher must show.' },
  { key: 'medicalRecord', group: 'document', title: 'Medical record', intro: 'The medical record, and whether it agrees with the claim form.' },
  { key: 'bank', group: 'document', title: 'Bank and payee', intro: 'Who is paid.' },
  { key: 'aiRead', group: 'document', title: 'What the AI read (information only)', intro: 'Shown on the case for the reviewer. These lines never stop a case.' },
];

const VOUCHER_FIELDS = { 'voucher.subtotal': 'Voucher amounts', 'voucher.date': 'Voucher dates', 'voucher.voucher_type': 'Voucher types' };
const BANK = ['bank.bank_name', 'bank.bank_account_name', 'bank.bank_account_number'];
const D = (code) => JUDGMENT_CHECKLIST_LABELS[code];

const CHECKS = [
  // Member check (modules/member-verification).
  { code: 'MEMBER_NOT_FOUND', section: 'member', question: 'Is the member in IAS?', label: 'Member found in IAS', effect: 'stops', locked: true,
    does: 'Looks up the member in IAS by NRC / passport and the treatment date (accident date, or the visit date).',
    fields: ['claimant.claimant_nrc_passport', 'claim.accident_date', 'claim.appointment_date'] },
  { code: 'COVERAGE_NOT_ACTIVE', section: 'member', question: 'Was the policy active on the treatment date?', label: 'Coverage active on the treatment date', effect: 'stops', locked: true,
    does: "The treatment date (accident date, or the visit date) must fall inside the member's coverage period in IAS. If no treatment date was read or IAS gives no coverage dates, the check cannot run and does not stop the case.",
    fields: ['claim.accident_date', 'claim.appointment_date'] },
  { code: 'member:dob', section: 'member', question: 'Does the date of birth match IAS?', label: MEMBER_ITEM_LABELS['member:dob'], effect: 'stops',
    does: 'The date of birth on the claim form must match the IAS record.', fields: ['claimant.claimant_dob'] },
  { code: 'member:policy', section: 'member', question: 'Does the policy number match IAS?', label: MEMBER_ITEM_LABELS['member:policy'], effect: 'stops',
    does: 'The policy number on the claim form must match the IAS record.', fields: ['policy.policy_no'] },
  { code: 'member:bank', section: 'member', question: 'Do the bank details match IAS?', label: MEMBER_ITEM_LABELS['member:bank'], effect: 'stops', locked: true,
    does: 'The bank name, account holder and account number must match the IAS record. A title such as U or Daw is ignored in the name.', fields: BANK },
  { code: 'member:balance', section: 'member', question: 'Is there enough balance for each voucher?', label: MEMBER_ITEM_LABELS['member:balance'], effect: 'stops', usesAi: true, locked: true,
    does: "Picks each voucher's benefit head, then compares each voucher amount with the member's remaining balance in IAS: the head, its benefit type and any combined limit, whichever is lowest. Vouchers that share a limit are added up." },
  { code: 'member:exclusion', section: 'member', question: 'Is the claim under a member or policy exclusion in IAS?', label: MEMBER_ITEM_LABELS['member:exclusion'], effect: 'stops', usesAi: true,
    does: "Reads the exclusions IAS holds for this member and this policy period, and judges by meaning whether the claim falls under one. Only exclusions dated on or before the treatment count. A likely match or an unsure answer stops the case for a person. Each line says whether the exclusion is at member or policy level." },
  { code: 'POSSIBLE_EXCLUSION', section: 'member', question: 'Could the diagnosis be excluded by the policy contract?', label: 'Possible policy contract exclusion', effect: 'warning', usesAi: true,
    does: 'Compares the diagnosis with the exclusion clauses of the policy contract (not the member or policy exclusions in IAS). A possible match is flagged for the approver (JD3), never rejected.',
    onFail: 'The case goes on, and the approver (JD3) sees the warning. If the System settings switch for review points is on, the claim does not go STP.' },
  { code: 'BENEFIT_NOT_ELIGIBLE', section: 'member', question: "Is the benefit type in the member's plan?", label: 'Benefit not eligible', effect: 'warning',
    does: "The claim's benefit type must be one of the benefit types in the member's IAS plan." },

  // Claim form.
  { code: 'MISSING_MANDATORY_FIELD', section: 'claimForm', question: 'Are all the required fields filled in?', label: 'One line per field, for example "Bank Information: Account Number"', effect: 'stops',
    does: 'Each required claim form field must be read: case number, policy, claimant, claim and bank details, and the customer signature.',
    fields: ['claimant.claimant_name', 'claimant.claimant_dob', 'claimant.claimant_nrc_passport', 'policy.policy_no', 'claim.appointment_date',
      'medical.hospital_or_clinic_name', 'claim.total_claim_amount', ...BANK] },
  { code: 'INCOMPLETE_CLAIM_FORM', section: 'claimForm', question: 'Does the claim form describe the illness and the treatment?', label: ISSUES.INCOMPLETE_CLAIM_FORM, effect: 'stops',
    does: 'Section B of the claim form must describe the illness or injury, or the treatment.',
    fields: ['medical.detail_of_illness_injury', 'medical.full_description_of_treatment'] },

  // Vouchers.
  { code: 'MISSING_VOUCHER', section: 'vouchers', question: 'Is there a voucher?', label: ISSUES.MISSING_VOUCHER, effect: 'stops', locked: true,
    does: 'At least one voucher or invoice must be attached.' },
  { code: 'UNCLEAR_VOUCHER', section: 'vouchers', question: 'Can each voucher be read?', label: ISSUES.UNCLEAR_VOUCHER, effect: 'stops',
    does: 'Each voucher must be clear enough to read its key details.' },
  { code: 'INCORRECT_VOUCHER', section: 'vouchers', question: 'Is each voucher stamped or signed?', label: ISSUES.INCORRECT_VOUCHER, effect: 'stops',
    does: "Each voucher must have a clinic or hospital letterhead or stamp, or the doctor's signature with the doctor's stamp." },
  { code: 'MISSING_VOUCHER_BREAKDOWN', section: 'vouchers', question: 'Does a pharmacy voucher list each medicine?', label: ISSUES.MISSING_VOUCHER_BREAKDOWN, effect: 'stops',
    does: 'A pharmacy voucher must show a line-by-line breakdown of the medicines.', fields: ['voucher.voucher_type'] },
  { code: 'VOUCHER_AMOUNT_MISMATCH', section: 'vouchers', question: 'Do the vouchers add up to the claimed amount?', label: ISSUES.VOUCHER_AMOUNT_MISMATCH, effect: 'stops',
    does: 'The voucher amounts must add up to the claimed amount on the claim form.', fields: ['voucher.subtotal', 'claim.total_claim_amount'] },
  { code: 'INVOICE_NAME_INCONSISTENT', section: 'vouchers', question: 'Is the claimant the patient on each voucher?', label: D('INVOICE_NAME_INCONSISTENT'), effect: 'stops', usesAi: true,
    does: 'Compares the claimant name on the claim form with the patient name on each voucher. Vouchers with no name are left out. Not compared on a claim for a child.',
    fields: ['claimant.claimant_name'] },
  { code: 'INVOICE_DATE_INCONSISTENT', section: 'vouchers', question: 'Does each voucher date match the medical record date?', label: 'Invoice date(s) are consistent with medical record date', effect: 'stops',
    does: 'Each voucher date must match the medical record date.', fields: ['voucher.date', 'medical_record.date'] },

  // Medical record.
  { code: 'NO_MEDICAL_REPORT', section: 'medicalRecord', question: 'Is there a medical record?', label: ISSUES.NO_MEDICAL_REPORT, effect: 'stops',
    does: "A medical record or doctor's record must be attached." },
  { code: 'INCOMPLETE_MEDICAL_REPORT', section: 'medicalRecord', question: 'Can the medical record be read?', label: ISSUES.INCOMPLETE_MEDICAL_REPORT, effect: 'stops',
    does: 'The medical record must be clear enough to read.' },
  { code: 'EYE_TEST_SLIP_UNDATED', section: 'medicalRecord', question: 'Is the eye test slip dated?', label: ISSUES.EYE_TEST_SLIP_UNDATED, effect: 'stops',
    does: 'If there is an eye test slip, it must show the treatment date. Shown only on claims with an eye test slip.' },
  { code: 'TREATMENT_DATE_INCONSISTENT', section: 'medicalRecord', question: 'Does the treatment date match the medical record?', label: 'Treatment date is consistent with medical record date', effect: 'stops',
    does: 'The claim date (accident date, or the visit date) must match the medical record date.',
    fields: ['claim.accident_date', 'claim.appointment_date', 'medical_record.date'] },
  { code: 'PATIENT_NAME_INCONSISTENT', section: 'medicalRecord', question: 'Is the claimant the patient on the medical record?', label: D('PATIENT_NAME_INCONSISTENT'), effect: 'stops', usesAi: true,
    does: 'Compares the claimant name on the claim form with the patient name on the medical record.', fields: ['claimant.claimant_name'] },
  { code: 'HOSPITAL_NAME_INCONSISTENT', section: 'medicalRecord', question: 'Is it the same hospital or clinic?', label: D('HOSPITAL_NAME_INCONSISTENT'), effect: 'stops', usesAi: true,
    does: 'Compares the hospital or clinic on the claim form with the one on the medical record.', fields: ['medical.hospital_or_clinic_name'] },
  { code: 'PROVIDER_NAME_INCONSISTENT', section: 'medicalRecord', question: 'Is it the same doctor?', label: D('PROVIDER_NAME_INCONSISTENT'), effect: 'off', usesAi: true,
    does: 'Would compare the doctor name on the claim form with the medical record. Off in the code because it flagged real, complete claims.' },
  { code: 'DIAGNOSIS_TREATMENT_INCONSISTENT', section: 'medicalRecord', question: 'Does the medical record support the diagnosis?', label: D('DIAGNOSIS_TREATMENT_INCONSISTENT'), effect: 'off', usesAi: true,
    does: 'Would check that the medical record supports the diagnosis on the claim form. Off in the code because it flagged real, complete claims.' },

  // Bank and payee.
  { code: 'MISSING_BANK_INFO', section: 'bank', question: 'Are the bank details given?', label: ISSUES.MISSING_BANK_INFO, effect: 'stops',
    does: 'Fails when the bank name, the account holder and the account number are all missing. One missing field is caught by the required fields check.', fields: BANK },
  { code: 'DELEGATION_LETTER_REQUIRED', section: 'bank', question: 'Is the claimant paid, or is there a delegation letter?', label: D('DELEGATION_LETTER_REQUIRED'), effect: 'stops', usesAi: true,
    does: 'Compares the claimant name with the bank account holder. A different person needs a delegation letter. Not asked on a claim for a child, which is paid to a parent.',
    fields: ['claimant.claimant_name', 'bank.bank_account_name'] },
  { code: 'DELEGATION_PAYEE_INCONSISTENT', section: 'bank', question: 'Does the delegation letter name the account holder?', label: D('DELEGATION_PAYEE_INCONSISTENT'), effect: 'stops', usesAi: true,
    does: 'Compares the payee named on the delegation letter with the bank account holder.', fields: ['bank.bank_account_name'] },

  // What the AI read (information lines).
  { code: 'DOCUMENT_LIST', section: 'aiRead', question: 'Which documents were found?', label: 'Documents found', effect: 'info', usesAi: true,
    does: 'The kind and date of each page the AI found.' },
  { code: 'DOCUMENT_DATES', section: 'aiRead', question: 'Are the medical documents dated?', label: 'Medical documents dated', effect: 'info', usesAi: true,
    does: 'Whether each medical document found has a date.' },
  { code: 'BENEFIT_TYPE', section: 'aiRead', question: 'Which benefit type do the documents show?', label: 'Benefit type', effect: 'info', usesAi: true,
    does: 'The benefit type that the documents show, next to the one on the claim form.' },
  { code: 'VITAMIN_OR_SUPPLEMENT', section: 'aiRead', question: 'Are there vitamins or supplements on the vouchers?', label: 'No vitamins / supplements on the vouchers', effect: 'info', usesAi: true,
    does: 'Lists the vitamin and supplement lines on each voucher.',
    onFail: 'If the System settings switch for vitamins is on, the claim does not go STP: a person approves it. The case goes on.' },
  { code: 'VALUE_FORMAT', section: 'aiRead', question: 'Do the values read look valid?', label: 'Values read look valid', effect: 'info',
    does: 'Checks the format of the values read (NRC, dates, amounts) and the voucher lines against the voucher amount.',
    onFail: 'The value is marked unsure for a person. If the System settings hold switches are on, the case waits for a person.' },
  { code: 'FIELDS_READ', section: 'aiRead', question: 'How sure was the AI of what it read?', label: 'Key values read clearly', effect: 'info', usesAi: true,
    does: 'How sure the AI was of each key value. At or below the confidence threshold (System settings), the value is unsure.',
    onFail: 'The value is marked unsure for a person. If the System settings hold switches are on, the case waits for a person.' },
];

// What happens when the check fails. A document check's customer sentence is the checklist's own issue text.
function ifFails(check) {
  if (check.effect === 'off') return null;
  if (check.onFail) return check.onFail;
  if (check.effect === 'info') return 'Nothing: shown on the case only.';
  if (check.effect === 'warning') return 'The case goes on. The reviewer or the approver sees the warning.';
  if (check.section === 'member') return 'The case waits for a person (member review), and the team is emailed. The customer is not emailed.';
  const sentence = ISSUES[check.code] || issueForFlag({ code: check.code, field: 'Account Number' });
  return `The case is incomplete and the customer is asked${check.code === 'MISSING_MANDATORY_FIELD' ? ', for example' : ''}: "${sentence}"`;
}

// What a person can do about this check on a case (ai-feedback/corrections.js correctionOptions).
function reviewerActions(check) {
  const actions = [];
  // Same rule as correctionOptions: a document line is a verdict unless NOT_VERDICT_ITEMS lists it. A check that is off
  // never has a pass or fail, so it is never offered.
  const isVerdict = check.section === 'member'
    ? ACCEPTABLE_MEMBER_ITEMS.has(check.code)
    : check.effect !== 'off' && !NOT_VERDICT_ITEMS.has(check.code);
  // The balance and exclusion findings' only action is a bypass with a reason (SYSTEM_5) — the same mark OK.
  if (isVerdict) actions.push(['member:balance', 'member:exclusion'].includes(check.code) ? 'Bypass (with a reason)' : 'Mark passed');
  if (isVerdict && check.section !== 'member' && ISSUES[check.code]) actions.push('Mark failed');
  const fields = (check.fields || []).map((key) => FIELD_LABELS[key] || VOUCHER_FIELDS[key]).filter(Boolean);
  if (fields.length) actions.push(`Correct: ${fields.join(', ')}`);
  return actions;
}

// Built once: the list does not change while the API runs.
const CATALOG = CHECKS.map(({ fields, onFail, ...check }) => ({
  usesAi: false, locked: false, ...check,
  group: SECTIONS.find((s) => s.key === check.section).group,
  ifFails: ifFails({ ...check, onFail }),
  reviewerCan: reviewerActions({ ...check, fields }),
}));

function catalog() {
  return { sections: SECTIONS, checks: CATALOG };
}

module.exports = { CHECKS, SECTIONS, catalog };
