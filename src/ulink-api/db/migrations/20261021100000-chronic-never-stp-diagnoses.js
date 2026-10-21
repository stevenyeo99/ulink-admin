'use strict';

// SYSTEM_4 E4-06 (A6): ULINK's chronic conditions list (docs/imp/CR/SYSTEM_4/Material/Common Chronic Medical Conditions
// and ICD-10-CM Codes.xlsx) never goes STP. Added to the never-STP diagnoses (a code prefix: a claim's diagnosis code
// that starts with it is blocked); ULINK edits the list on the STP settings page afterwards.
// The sheet uses ICD-10-CM. IAS has both ICD-10 and ICD-10-CM codes (DIAG_CLASS_ICD10 / DIAG_CLASS_ICD10CM), but this
// system's copy (ulink_icd10_diagnoses) holds only the ICD-10 class. The CM codes on the sheet that the ICD-10 class
// lacks are covered by the nearest ICD-10 prefix (owner, 2026-10-21): I25.110 / I25.118 / I25.119 → I25.11 (which
// also matches the CM codes themselves), L40.50 → L40.5, M45.9 → M45. B19.10 / B19.11 have no ICD-10 parent for
// hepatitis B (B19 is any unspecified viral hepatitis), so they are listed as written.
// Autoimmune conditions count as chronic only under immunomodulatory therapy; a code cannot tell, so they always go to
// a person. A prefix already on the list is left as it is. down: removes only the rows this migration inserted (same
// prefix and note), so a prefix ULINK had added by hand stays.

const DIAGNOSES = [
  ['E11.9', 'Chronic: type 2 diabetes mellitus without complications'],
  ['I10', 'Chronic: essential (primary) hypertension'],
  ['I21.4', 'Chronic: non-ST elevation myocardial infarction (NSTEMI)'],
  ['I21.9', 'Chronic: acute myocardial infarction, unspecified'],
  ['I25.10', 'Chronic: atherosclerotic heart disease without angina pectoris'],
  ['I25.11', 'Chronic: atherosclerotic heart disease of native coronary artery with angina pectoris (sheet: I25.110, I25.118, I25.119)'],
  ['I25.2', 'Chronic: old myocardial infarction'],
  ['I25.5', 'Chronic: ischemic cardiomyopathy'],
  ['I25.6', 'Chronic: silent myocardial ischemia'],
  ['I25.9', 'Chronic: chronic ischemic heart disease, unspecified'],
  ['B18.0', 'Chronic: chronic viral hepatitis B with delta-agent'],
  ['B18.1', 'Chronic: chronic viral hepatitis B without delta-agent'],
  ['B16.9', 'Chronic: acute hepatitis B without delta-agent and without hepatic coma'],
  ['B16.1', 'Chronic: acute hepatitis B with delta-agent and without hepatic coma'],
  ['B19.10', 'Chronic: unspecified viral hepatitis B without hepatic coma (ICD-10-CM)'],
  ['B19.11', 'Chronic: unspecified viral hepatitis B with hepatic coma (ICD-10-CM)'],
  ['M06.9', 'Chronic (under immunomodulatory therapy): rheumatoid arthritis, unspecified'],
  ['M32.9', 'Chronic (under immunomodulatory therapy): systemic lupus erythematosus, unspecified'],
  ['M45', 'Chronic (under immunomodulatory therapy): ankylosing spondylitis (sheet: M45.9)'],
  ['L40.5', 'Chronic (under immunomodulatory therapy): psoriatic arthritis (sheet: L40.50)'],
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const [code, note] of DIAGNOSES) {
      await queryInterface.sequelize.query(
        `INSERT INTO ulink_stp_blocked_diagnoses (code_prefix, note, created_at, updated_at)
         VALUES (:code, :note, :now, :now) ON CONFLICT (code_prefix) DO NOTHING`,
        { replacements: { code, note, now } }
      );
    }
  },
  async down(queryInterface) {
    for (const [code, note] of DIAGNOSES) {
      await queryInterface.sequelize.query('DELETE FROM ulink_stp_blocked_diagnoses WHERE code_prefix = :code AND note = :note', {
        replacements: { code, note },
      });
    }
  },
};
