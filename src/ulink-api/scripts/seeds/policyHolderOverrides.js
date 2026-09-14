// Hand-transcribed from docs/imp/demo/20260914/samples/"AYAHealth_Special Conditions and
// Benefit Clarifications- Combined update_08-MAY-26.xlsx", sheet "Special Terms and
// Conditions". Merged Policy Holder Name cells (A3:A6=IGT, A7:A10=ATOM, A17:A18=NRC —
// confirmed via openpyxl's ws.merged_cells.ranges, not guessed from blank-cell adjacency)
// group multiple coverage rows under one policyholder.
//
// Rows naming a specific individual (a named employee's maternity waiver, one member's
// cancer-claim routing) are transcribed as a policyholder-level note WITHOUT the person's
// name/NRC/DOB — this table is matched by company name only, not by member, so per-person
// detail isn't needed for matching and shouldn't be duplicated into a new table. The
// original spreadsheet remains the source of truth for who specifically is covered.
//
// routeKey is left null throughout — these are policyholder-level overrides, independent of
// which insurer/product route recognized the claim (AYA Health is the only product these
// come from today, but the override itself is about the employer group, not the product).

const ROWS = [
  ['HEINEKEN MYANMAR LIMITED', 'Vaccination', 'Allows campaign vaccination only for seasonal influenza (not a blanket vaccination-campaign ban).'],

  ['Irrawady Green Towers (IGT)', 'Vaccination', 'All vaccination types (including influenza) covered with a doctor’s prescription, for all members regardless of age. No mass immunizations/campaigns allowed.'],
  ['Irrawady Green Towers (IGT)', 'Cancer Claims', 'A specific named member’s cancer claims must be processed under IPD regardless of treatment type (member-specific; see original spreadsheet for who).'],
  ['Irrawady Green Towers (IGT)', 'Maternity', 'Maternity waiting period waived for all existing female members.'],
  ['Irrawady Green Towers (IGT)', 'TOB', 'Prescribed Physiotherapy/Speech/Oculomotor Therapy, Medical Aids, and Alternative Medicine (chiropractor, homeopathy, osteopathy, acupuncture, TCM) are covered with a doctor’s prescription. Outpatient Psychiatric Treatment (no waiting period) reviewed case-by-case; other listed OP services (GP/Specialist, Lab/X-Ray/Diagnostic, Prescribed Drugs incl. supplements) also covered, supplements/drugs reviewed case-by-case. Inpatient psychiatric treatment is NOT covered.'],

  ['ATOM', 'Vaccination', 'All vaccination types (including influenza) covered with a doctor’s prescription, for all members regardless of age. No mass immunizations/campaigns allowed.'],
  ['ATOM', 'Dental', 'Crowns and implants covered under dental benefit: up to 250,000 MMK per procedure, up to 550,000 MMK per policy period. No cover for cosmetic purposes, dental bracing, or precious metals.'],
  ['ATOM', 'Maternity', 'Maternity waiting period waived for existing female members; 6-month waiting period applies to future female members; max 10 working days backdating for leavers/joiners.'],
  ['ATOM', 'Newborn', 'Newborn 0-14 days covered under mother’s IPD benefit limit if later subscribed as a member (eligible after 15 days); otherwise covered under the Maternity benefit limit.'],

  ['Myanmar Jardine Schindler Limited', 'Maternity', 'Maternity waiting period waived for specific named female employees on file (see original spreadsheet for the list).'],
  ['Danish Refugee Council', 'Maternity', 'Maternity waiting period waived for specific named female employees on file; waiver does not apply to other members, including new joiners.'],
  ['AYA SOMPO INSURANCE COMPANY LIMITED', 'Maternity', 'Maternity waiting period waived for female employees, including new joiners.'],
  ['MALTESER INTERNATIONAL COMPANY LIMITED', 'Maternity', 'Only a 6-month waiting period applies to maternity benefits for all female members.'],
  ['International Rescue Committee (IRC)', 'Maternity', 'Maternity waiting period waived for female employees, but not for new joiners.'],
  ['Digital Money Myanmar Limited', 'Maternity', 'Maternity waiting period waived for female employees, but not for new joiners.'],

  ['Norwegian Refugee Council (NRC)', 'Maternity', 'Standard 10-month maternity waiting period waiver applies only to the existing participants list, not to new joiners.'],
  ['Norwegian Refugee Council (NRC)', 'Claim Validity Period', 'Claim submission period extended to 90 days for staff stationed in Kachin townships.'],

  ['RELIEF INTERNATIONAL', 'Claim Validity Period', 'Claim submission period extended to 90 days for staff stationed in Rakhine townships.'],

  ['Both individual and group policies', 'Coronary Heart Disease', 'Assessed under Chronic Condition benefits.'],
  ['Both individual and group policies', 'Hepatitis B Infection', 'Assessed under Chronic Condition benefits.'],
  ['Both individual and group policies', 'Pre-Operative Investigation', 'Covered under inpatient benefits for all policyholders. Cashless: submit together with the corresponding inpatient/day-care claim. Reimbursement submitted separately: requires the admission note or operation record to process under inpatient benefits.'],
  ['Both individual and group policies', 'Cancer-related claims', 'All cancer-related claims, regardless of treatment type, are covered under inpatient benefits for all policyholders.'],
];

module.exports = {
  overrides: ROWS.map(([policyHolderName, coverageArea, note]) => ({
    routeKey: null,
    policyHolderName: policyHolderName === 'Both individual and group policies' ? null : policyHolderName,
    coverageArea,
    note: policyHolderName === 'Both individual and group policies' ? `[Applies broadly, all policyholders] ${note}` : note,
  })),
};
