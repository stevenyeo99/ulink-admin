'use strict';

// Adds identity_consistency.bank_account_holder_consistent — a confirmed JD2-scope rule
// (docs/samples/20260820/20260821 ULINK STP Confirmed Assumptions and Implementation
// Advice.md: "delegation letter required when recipient/account holder differs from
// claimant") pulled forward into JD1's checklist as a plain detection flag, verified
// against real sample data (incomplete/jd2, Khin Maung): bank.bank_account_name
// ("ကျော်သန်းအောင်") is a different person from claimant.claimant_name ("Khin Maung"),
// not a script/spelling variant of the same name. LLM-judged like the other 3
// identity_consistency fields, for the same reason — script differences (Latin claimant
// name vs Burmese account name) make code-level string comparison structurally unable to
// judge it.

const AYAS_MEMBER_CLAIM_SCHEMA = {
  type: 'object',
  required: [
    'policy',
    'claimant',
    'claim',
    'medical',
    'bank',
    'documents_present',
    'medical_record',
    'invoices',
    'identity_consistency',
  ],
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
    invoices: {
      type: 'object',
      required: ['present', 'items'],
      properties: {
        present: { type: 'boolean' },
        items: {
          type: 'array',
          description:
            'One entry per separate physical voucher/receipt found — a hospital receipt and a separate ' +
            'pharmacy receipt are two entries, not one. Empty array when present is false.',
          items: {
            type: 'object',
            required: [
              'legible',
              'has_itemized_breakdown',
              'has_clinic_stamp_or_doctor_signature',
              'date_of_voucher',
              'subtotal',
              'patient_name',
              'hospital_or_clinic_name',
              'line_items',
            ],
            properties: {
              legible: { type: ['boolean', 'null'] },
              has_itemized_breakdown: { type: ['boolean', 'null'] },
              has_clinic_stamp_or_doctor_signature: {
                type: ['boolean', 'null'],
                description:
                  "True if this voucher carries an official clinic/hospital stamp, or the treating doctor's own " +
                  'signature together with the doctor\'s personal stamp. False if it carries no such mark, or only ' +
                  "an unrelated mark (e.g. a pharmacy's own dispensing stamp, which confirms medicine handout, not " +
                  'clinic/doctor certification). Null only when the voucher itself could not be assessed (e.g. illegible).',
              },
              date_of_voucher: { type: ['string', 'null'] },
              subtotal: { type: ['number', 'null'], description: "This voucher's own total amount." },
              patient_name: { type: ['string', 'null'] },
              hospital_or_clinic_name: { type: ['string', 'null'] },
              line_items: {
                type: 'array',
                description: 'Best-effort per-line capture within this voucher. Empty array when has_itemized_breakdown is false.',
                items: {
                  type: 'object',
                  required: ['name', 'price'],
                  properties: {
                    name: { type: ['string', 'null'] },
                    price: { type: ['number', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    identity_consistency: {
      type: 'object',
      required: [
        'patient_name_consistent',
        'invoice_provider_consistent',
        'medical_record_provider_consistent',
        'bank_account_holder_consistent',
      ],
      properties: {
        patient_name_consistent: { type: ['boolean', 'null'] },
        invoice_provider_consistent: { type: ['boolean', 'null'] },
        medical_record_provider_consistent: { type: ['boolean', 'null'] },
        bank_account_holder_consistent: {
          type: ['boolean', 'null'],
          description:
            'Does bank.bank_account_name refer to the same person as claimant.claimant_name? false means the ' +
            'payment recipient is a genuinely different person from the claimant (delegation-letter territory), ' +
            'not merely a different script/spelling of the same name.',
        },
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
