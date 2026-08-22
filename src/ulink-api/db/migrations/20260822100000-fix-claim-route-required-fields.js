'use strict';

// Fixes a real gap found via manual testing: only the top-level groups (policy, claimant,
// claim, medical, bank) were required, not the fields WITHIN each group — so the LLM could
// silently omit a field instead of returning it as null, and ajv had nothing to catch that
// with. This breaks the "fixed JSON, always the same keys" guarantee. Adds `required` to
// every leaf group so a response missing a key now fails validation -> MANUAL_REVIEW
// instead of being silently accepted as a complete RECOGNIZED result.

const AYAS_MEMBER_CLAIM_SCHEMA = {
  type: 'object',
  required: ['policy', 'claimant', 'claim', 'medical', 'bank', 'documents_present', 'medical_record', 'invoice'],
  properties: {
    policy: {
      type: 'object',
      required: ['issue_no', 'product_name', 'policy_no', 'policy_holder_name', 'company_name', 'channel'],
      properties: {
        issue_no: { type: ['string', 'null'] },
        product_name: { type: ['string', 'null'] },
        policy_no: { type: ['string', 'null'] },
        policy_holder_name: { type: ['string', 'null'] },
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
      required: ['claim_benefit_type', 'type_of_patient', 'appointment_date', 'reported_date', 'treatment_outside_myanmar', 'total_claim_amount'],
      properties: {
        claim_benefit_type: { type: ['string', 'null'] },
        type_of_patient: { type: ['string', 'null'] },
        appointment_date: { type: ['string', 'null'] },
        reported_date: { type: ['string', 'null'] },
        treatment_outside_myanmar: { type: ['boolean', 'null'] },
        total_claim_amount: { type: ['number', 'null'] },
      },
    },
    medical: {
      type: 'object',
      required: ['detail_of_illness_injury', 'doctor_name', 'hospital_or_clinic_name'],
      properties: {
        detail_of_illness_injury: { type: ['string', 'null'] },
        doctor_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
      },
    },
    bank: {
      type: 'object',
      required: ['bank_name', 'bank_account_name', 'bank_account_number'],
      properties: {
        bank_name: { type: ['string', 'null'] },
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
    medical_record: {
      type: 'object',
      required: ['present'],
      properties: {
        present: { type: 'boolean' },
      },
    },
    invoice: {
      type: 'object',
      required: ['present', 'date_of_voucher', 'invoice_amount', 'patient_name'],
      properties: {
        present: { type: 'boolean' },
        date_of_voucher: { type: ['string', 'null'] },
        invoice_amount: { type: ['number', 'null'] },
        patient_name: { type: ['string', 'null'] },
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
    // Original (looser) schema is preserved in 20260822090000-add-claim-recognition.js's
    // history — not worth restoring it, the stricter version is strictly better.
  },
};
