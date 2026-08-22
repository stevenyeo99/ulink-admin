'use strict';

// Claim Recognition module - Lego block 2 (email + document recognition, OCR field extraction).
// See docs/imp/day1/drt-claim-demo-implementation-plan.md

const AYAS_MEMBER_CLAIM_SCHEMA = {
  type: 'object',
  required: ['policy', 'claimant', 'claim', 'medical', 'bank', 'documents_present', 'medical_record', 'invoice'],
  properties: {
    policy: {
      type: 'object',
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
      properties: {
        detail_of_illness_injury: { type: ['string', 'null'] },
        doctor_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
      },
    },
    bank: {
      type: 'object',
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
    // Per meeting notes: medical = presence only; invoice = capture the voucher's own
    // date/amount/patient_name as raw fields. Comparison against the form's fields
    // (claim.total_claim_amount, claimant.claimant_name, claim.appointment_date) happens
    // in code afterward, not as a pre-decided boolean from the LLM.
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
    await queryInterface.createTable('ulink_claim_routes', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      route_key: { type: Sequelize.STRING, allowNull: false, unique: true },
      label: { type: Sequelize.STRING, allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      insurer: { type: Sequelize.STRING, allowNull: true },
      claim_type: { type: Sequelize.STRING, allowNull: true },
      extraction_schema: { type: Sequelize.JSONB, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.bulkInsert('ulink_claim_routes', [
      {
        id: Sequelize.literal('gen_random_uuid()'),
        route_key: 'ayas_member_claim',
        label: 'AYAS Member Claim Submission',
        enabled: true,
        insurer: 'AYAS',
        claim_type: 'M',
        extraction_schema: JSON.stringify(AYAS_MEMBER_CLAIM_SCHEMA),
        created_at: Sequelize.literal('now()'),
        updated_at: Sequelize.literal('now()'),
      },
    ]);

    await queryInterface.addColumn('ulink_cases', 'recognized_type', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('ulink_cases', 'extracted_fields', { type: Sequelize.JSONB, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ulink_cases', 'extracted_fields');
    await queryInterface.removeColumn('ulink_cases', 'recognized_type');
    await queryInterface.dropTable('ulink_claim_routes');
  },
};
