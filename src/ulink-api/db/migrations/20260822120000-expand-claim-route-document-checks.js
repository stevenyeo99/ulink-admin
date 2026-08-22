'use strict';

// Expands medical_record and invoice from "presence only" into raw-field capture (mirroring
// the pattern already working for invoice) — needed to support the real document-checking
// checklist (unclear/incorrect/incomplete voucher or medical report, missing itemized
// pharmacy breakdown). Code does every comparison against the form's own fields; the LLM
// only reports what's actually on each supporting document. Scoped to the ayas_member_claim
// route only, per confirmed scope.

const AYAS_MEMBER_CLAIM_SCHEMA = {
  type: 'object',
  required: ['policy', 'claimant', 'claim', 'medical', 'bank', 'documents_present', 'medical_record', 'invoice'],
  properties: {
    policy: {
      type: 'object',
      required: ['issue_no', 'product_name', 'policy_no', 'policy_holder_name', 'policy_holder_nrc_passport', 'company_name', 'channel'],
      properties: {
        issue_no: { type: ['string', 'null'] },
        product_name: { type: ['string', 'null'] },
        policy_no: { type: ['string', 'null'] },
        policy_holder_name: { type: ['string', 'null'] },
        policy_holder_nrc_passport: { type: ['string', 'null'] },
        company_name: { type: ['string', 'null'] },
        channel: { type: ['string', 'null'] },
      },
    },
    claimant: {
      type: 'object',
      required: ['claimant_name', 'claimant_nrc_passport', 'claimant_dob', 'is_claim_for_child', 'phone_number', 'email_address'],
      properties: {
        claimant_name: { type: ['string', 'null'] },
        claimant_nrc_passport: { type: ['string', 'null'] },
        claimant_dob: { type: ['string', 'null'] },
        is_claim_for_child: { type: ['boolean', 'null'] },
        phone_number: { type: ['string', 'null'] },
        email_address: { type: ['string', 'null'] },
      },
    },
    claim: {
      type: 'object',
      required: [
        'insurer_case_number',
        'date_submitted',
        'claim_benefit_type',
        'type_of_patient',
        'accident_date',
        'accident_time',
        'appointment_date',
        'appointment_time',
        'reported_date',
        'reported_time',
        'treatment_outside_myanmar',
        'total_claim_amount',
      ],
      properties: {
        insurer_case_number: { type: ['string', 'null'] },
        date_submitted: { type: ['string', 'null'] },
        claim_benefit_type: { type: ['string', 'null'] },
        type_of_patient: { type: ['string', 'null'] },
        accident_date: { type: ['string', 'null'] },
        accident_time: { type: ['string', 'null'] },
        appointment_date: { type: ['string', 'null'] },
        appointment_time: { type: ['string', 'null'] },
        reported_date: { type: ['string', 'null'] },
        reported_time: { type: ['string', 'null'] },
        treatment_outside_myanmar: { type: ['boolean', 'null'] },
        total_claim_amount: { type: ['number', 'null'] },
      },
    },
    medical: {
      type: 'object',
      required: ['detail_of_illness_injury', 'full_description_of_treatment', 'doctor_name', 'hospital_or_clinic_name'],
      properties: {
        detail_of_illness_injury: { type: ['string', 'null'] },
        full_description_of_treatment: { type: ['string', 'null'] },
        doctor_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
      },
    },
    bank: {
      type: 'object',
      required: ['bank_name', 'bank_address', 'bank_account_name', 'bank_account_number'],
      properties: {
        bank_name: { type: ['string', 'null'] },
        bank_address: { type: ['string', 'null'] },
        bank_account_name: { type: ['string', 'null'] },
        bank_account_number: { type: ['string', 'null'] },
      },
    },
    documents_present: {
      type: 'object',
      required: ['has_medical_record_photo', 'has_bill_photo', 'has_customer_signature'],
      properties: {
        has_medical_record_photo: { type: 'boolean' },
        has_bill_photo: { type: 'boolean' },
        has_customer_signature: { type: 'boolean' },
      },
    },
    // Supports: "No Medical Report(s)" (present:false), "Unclear ... medical report(s)"
    // (legible:false), "Incorrect ...medical report(s)" / "Incorrect patient details"
    // (code compares patient_name/doctor_name/hospital_or_clinic_name/date against
    // claimant.*/medical.* from the form), "Incomplete medical report(s)" (legible:false
    // or a missing field where the document type normally has one).
    medical_record: {
      type: 'object',
      required: ['present', 'legible', 'patient_name', 'doctor_name', 'hospital_or_clinic_name', 'date'],
      properties: {
        present: { type: 'boolean' },
        legible: { type: ['boolean', 'null'] },
        patient_name: { type: ['string', 'null'] },
        doctor_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
        date: { type: ['string', 'null'] },
      },
    },
    // Supports: "Missing voucher(s)" (present:false), "Unclear voucher(s)" (legible:false),
    // "Incorrect voucher(s)" (code compares patient_name/hospital_or_clinic_name against the
    // form), "Missing detailed breakdown for pharmacy charges" (has_itemized_breakdown:false),
    // "Amount ... not consistent with the claimed amount" (code compares invoice_amount
    // against claim.total_claim_amount).
    invoice: {
      type: 'object',
      required: ['present', 'legible', 'has_itemized_breakdown', 'date_of_voucher', 'invoice_amount', 'patient_name', 'hospital_or_clinic_name'],
      properties: {
        present: { type: 'boolean' },
        legible: { type: ['boolean', 'null'] },
        has_itemized_breakdown: { type: ['boolean', 'null'] },
        date_of_voucher: { type: ['string', 'null'] },
        invoice_amount: { type: ['number', 'null'] },
        patient_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
      },
    },
  },
};

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkUpdate(
      'ulink_claim_routes',
      { extraction_schema: JSON.stringify(AYAS_MEMBER_CLAIM_SCHEMA), updated_at: Sequelize.literal('now()') },
      { route_key: 'ayas_member_claim' }
    );
  },

  async down() {
    // Superseded by this migration; not worth restoring the narrower prior version.
  },
};
