'use strict';

// Deadline-driven simplification (2026-08-22): invoices.items[].patient_name,
// hospital_or_clinic_name, date_of_voucher, and line_items were the demonstrated source of
// repeated fabrication (verified against real data — complete/1, Hlaing Myo Oo: a
// non-priced handwritten dosage note got reported as a second priced voucher with an
// invented pharmacy name, patient name, date, and line items copied from the real
// voucher). None of them were read by any currently-active document-checking rule anyway
// — checkIncorrectVoucher/checkVoucherAmountMismatch only ever used subtotal and
// has_clinic_stamp_or_doctor_signature; patient_name/hospital_or_clinic_name were only
// consumed via identity_consistency.patient_name_consistent/invoice_provider_consistent,
// both already disabled or unused (see document-checking/checklist.js). Removing the field
// removes the surface to fabricate on, for zero loss of active functionality.
// invoice_provider_consistent is dropped from identity_consistency for the same reason —
// its only input (invoices.items[].hospital_or_clinic_name) no longer exists.
// has_vitamin_or_supplement is new — picks up a confirmed but not-yet-built JD2 requirement
// (docs/samples/20260820/20260821 ULINK STP Confirmed Assumptions and Implementation
// Advice.md: "Detect and flag if invoice/voucher contains vitamin or supplement items.
// Store the flag for later claim API/coding behavior") — not consumed by any
// document-checking rule yet, just captured for later.

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
            'pharmacy receipt are two entries, not one. Empty array when present is false. A page with no ' +
            'monetary amount on it at all is not a voucher — do not give it an entry.',
          items: {
            type: 'object',
            required: ['legible', 'has_itemized_breakdown', 'has_clinic_stamp_or_doctor_signature', 'subtotal', 'has_vitamin_or_supplement'],
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
              subtotal: { type: ['number', 'null'], description: "This voucher's own total amount." },
              has_vitamin_or_supplement: {
                type: ['boolean', 'null'],
                description:
                  'True if any line item on this voucher is a vitamin or dietary/nutritional supplement. ' +
                  'False if the voucher is legible enough to tell none are. Null if not assessable (e.g. illegible).',
              },
            },
          },
        },
      },
    },
    identity_consistency: {
      type: 'object',
      required: ['patient_name_consistent', 'medical_record_provider_consistent', 'bank_account_holder_consistent'],
      properties: {
        patient_name_consistent: { type: ['boolean', 'null'] },
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
