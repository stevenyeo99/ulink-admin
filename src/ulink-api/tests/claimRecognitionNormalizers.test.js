const { invalidateCopiedMedicalRecord } = require('../modules/claim-recognition/service');

// Regression test for the 2026-09-16 fix (case c9430f24-d487-4a96-881a-6e501d410918): the
// model marked medical_record.present: true against what was actually just the same invoice
// photo, filling diagnosis_or_treatment by copying the claim form's own illness text —
// verified against that case's real extractedFields.
describe('invalidateCopiedMedicalRecord', () => {
  const fields = {
    medical: { detail_of_illness_injury: 'Hepatitis B Second Time', full_description_of_treatment: 'Hepatitis B Second time' },
    medical_record: {
      present: true,
      legible: true,
      doctor_name: 'May Thinzar Htoo',
      patient_name: 'Ma Su Yin Mon',
      hospital_or_clinic_name: 'Pun Hlaing Clinic (TWC)',
      diagnosis_or_treatment: 'Hepatitis B Second time',
      date: '2024-07-25',
    },
  };

  it('resets a medical_record whose diagnosis is copied from the claim form (case-insensitive)', () => {
    const result = invalidateCopiedMedicalRecord(fields);
    expect(result.medical_record).toMatchObject({
      present: false,
      legible: null,
      patient_name: null,
      doctor_name: null,
      hospital_or_clinic_name: null,
      date: null,
      diagnosis_or_treatment: null,
      presence_confidence: 0,
    });
    expect(result.medical_record.presence_reason).toContain('copied verbatim');
  });

  it('leaves a medical_record with its own independent diagnosis text untouched', () => {
    const distinct = { ...fields, medical_record: { ...fields.medical_record, diagnosis_or_treatment: 'Stage 2 Hepatitis B, mild jaundice noted' } };
    expect(invalidateCopiedMedicalRecord(distinct)).toBe(distinct);
  });

  it('leaves a genuinely absent medical_record untouched', () => {
    const absent = { ...fields, medical_record: { present: false, legible: null, diagnosis_or_treatment: null } };
    expect(invalidateCopiedMedicalRecord(absent)).toBe(absent);
  });

  it('leaves a present record with no diagnosis text untouched', () => {
    const noDiagnosis = { ...fields, medical_record: { ...fields.medical_record, diagnosis_or_treatment: null } };
    expect(invalidateCopiedMedicalRecord(noDiagnosis)).toBe(noDiagnosis);
  });
});
