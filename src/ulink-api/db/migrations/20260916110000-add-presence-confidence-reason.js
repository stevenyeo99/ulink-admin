'use strict';

// Adds presence_confidence/presence_reason to medical_record and invoices — asks the model
// to show its work on the one judgment call this session's investigation found it getting
// wrong silently (case c9430f24-d487-4a96-881a-6e501d410918: an invoice photo misread as a
// medical record, with no confidence/reason ever surfaced to explain or challenge it).
// Demo value: the console can now show *why* the system believes a document was submitted,
// not just the boolean. invalidateCopiedMedicalRecord (claim-recognition/service.js) also
// fills these on its own override, so a corrected record still explains itself.
//
// Full schema rewrite (same pattern as every prior schema-evolution migration) — ajv
// validates the whole object, so this is the current live schema (pulled from
// ulink_claim_routes at time of writing) plus the four new properties, not a diff.

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
    'delegation_letter',
  ],
  properties: {
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
        accident_date: { type: ['string', 'null'] },
        accident_time: { type: ['string', 'null'] },
        reported_date: { type: ['string', 'null'] },
        reported_time: { type: ['string', 'null'] },
        date_submitted: { type: ['string', 'null'] },
        type_of_patient: { type: ['string', 'null'] },
        appointment_date: { type: ['string', 'null'] },
        appointment_time: { type: ['string', 'null'] },
        claim_benefit_type: { type: ['string', 'null'] },
        total_claim_amount: { type: ['number', 'null'] },
        insurer_case_number: { type: ['string', 'null'] },
        treatment_outside_myanmar: { type: ['boolean', 'null'] },
      },
    },
    policy: {
      type: 'object',
      required: ['issue_no', 'product_name', 'policy_no', 'policy_holder_name', 'policy_holder_nrc_passport', 'company_name', 'channel'],
      properties: {
        channel: { type: ['string', 'null'] },
        issue_no: { type: ['string', 'null'] },
        policy_no: { type: ['string', 'null'] },
        company_name: { type: ['string', 'null'] },
        product_name: { type: ['string', 'null'] },
        policy_holder_name: { type: ['string', 'null'] },
        policy_holder_nrc_passport: { type: ['string', 'null'] },
      },
    },
    medical: {
      type: 'object',
      required: ['detail_of_illness_injury', 'full_description_of_treatment', 'doctor_name', 'hospital_or_clinic_name'],
      properties: {
        doctor_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
        detail_of_illness_injury: { type: ['string', 'null'] },
        full_description_of_treatment: { type: ['string', 'null'] },
      },
    },
    claimant: {
      type: 'object',
      required: ['claimant_name', 'claimant_nrc_passport', 'claimant_dob', 'is_claim_for_child', 'phone_number', 'email_address'],
      properties: {
        claimant_dob: { type: ['string', 'null'] },
        phone_number: { type: ['string', 'null'] },
        claimant_name: { type: ['string', 'null'] },
        email_address: { type: ['string', 'null'] },
        is_claim_for_child: { type: ['boolean', 'null'] },
        claimant_nrc_passport: { type: ['string', 'null'] },
      },
    },
    invoices: {
      type: 'object',
      required: ['present', 'items', 'presence_confidence', 'presence_reason'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'legible',
              'has_itemized_breakdown',
              'has_clinic_stamp_or_doctor_signature',
              'subtotal',
              'has_vitamin_or_supplement',
              'voucher_type',
              'date',
            ],
            properties: {
              legible: { type: ['boolean', 'null'] },
              subtotal: { type: ['number', 'null'], description: "This voucher's own total amount." },
              date: {
                type: ['string', 'null'],
                description:
                  "This voucher's own date, as printed/written on it — the service/purchase date, not a separate issued/printed date if the voucher happens to show both. ISO YYYY-MM-DD. Null if the voucher has no date on it, or it's illegible.",
              },
              voucher_type: {
                enum: ['consultation', 'pharmacy', 'lab', 'optical', 'other', null],
                type: ['string', 'null'],
                description:
                  'What this specific voucher is billing for, based ONLY on what is visibly printed/typed on it — never inferred from the claim form or guessed from context. "consultation": doctor/service visit charges (e.g. "Consultant Fees", "Medical Service Fees", a "Specialist" line, a recommendation letter/DC ticket) — no medicine listed. "pharmacy": itemized drug/medicine names (specific drug names with quantities/dosage), a dispensing receipt — no consultation/service fee listed. "lab": diagnostic/imaging test names (e.g. X-ray, USG, a blood-test panel) on a requisition or result slip. "optical": eyewear order/receipt — frame/lens details, a prescription table (SPH/CYL/AXIS/ADD/PD), an optical shop name — not a drug dispensing receipt even if it carries a dispensing-style stamp. "other": legible and priced but does not clearly fit one of those (e.g. genuinely mixes consultation and medicine on one slip). Null only when the voucher itself could not be assessed at all (e.g. illegible) — not a substitute for "other" when it is legible but ambiguous; those are different things.',
              },
              has_itemized_breakdown: { type: ['boolean', 'null'] },
              has_vitamin_or_supplement: {
                type: ['boolean', 'null'],
                description:
                  'True if any line item on this voucher is a vitamin or dietary/nutritional supplement. False if the voucher is legible enough to tell none are. Null if not assessable (e.g. illegible).',
              },
              has_clinic_stamp_or_doctor_signature: {
                type: ['boolean', 'null'],
                description:
                  "True if this voucher carries an official clinic/hospital stamp, or the treating doctor's own signature together with the doctor's personal stamp. False if it carries no such mark, or only an unrelated mark (e.g. a pharmacy's own dispensing stamp, which confirms medicine handout, not clinic/doctor certification). Null only when the voucher itself could not be assessed (e.g. illegible).",
              },
            },
          },
          description:
            'One entry per separate physical voucher/receipt found — a hospital receipt and a separate pharmacy receipt are two entries, not one. Empty array when present is false. A page with no monetary amount on it at all is not a voucher — do not give it an entry.',
        },
        present: { type: 'boolean' },
        presence_confidence: {
          type: 'number',
          description:
            'How confident you are in the invoices.present determination above (and, when present, that every entry in items is a genuine distinct voucher — not a duplicate, not a non-priced page misread as one). 0.0-1.0. 1.0 only for an unambiguous, clearly legible voucher (or an unambiguous absence — no bill/receipt-shaped page anywhere). Lower for a borderline call: a partially obscured/rotated photo, a page that could plausibly be a receipt or something else, or uncertainty over whether two entries are really separate vouchers.',
        },
        presence_reason: {
          type: ['string', 'null'],
          description:
            'One short sentence on what you actually saw that led to the presence_confidence/present values above — e.g. "Clear Invoice Cum Receipt with itemized charges and a paid stamp" or "No page anywhere shows a priced bill or receipt". Null only if present/presence_confidence themselves could not be assessed at all.',
        },
      },
    },
    medical_record: {
      type: 'object',
      required: [
        'present',
        'legible',
        'patient_name',
        'doctor_name',
        'hospital_or_clinic_name',
        'date',
        'diagnosis_or_treatment',
        'presence_confidence',
        'presence_reason',
      ],
      properties: {
        date: { type: ['string', 'null'] },
        legible: { type: ['boolean', 'null'] },
        present: { type: 'boolean' },
        doctor_name: { type: ['string', 'null'] },
        patient_name: { type: ['string', 'null'] },
        hospital_or_clinic_name: { type: ['string', 'null'] },
        diagnosis_or_treatment: {
          type: ['string', 'null'],
          description:
            "The diagnosis, clinical finding, or treatment actually written on the medical record document itself — not copied from the claim form's own medical.detail_of_illness_injury/full_description_of_treatment, even if they happen to say the same thing. Null if the medical record doesn't state one, or it's illegible.",
        },
        presence_confidence: {
          type: 'number',
          description:
            'How confident you are in the medical_record.present determination above. 0.0-1.0. 1.0 only for an unambiguous, clearly legible clinical document (a doctor\'s note, prescription, discharge summary — actual clinical content, not just a document that happens to list a patient/doctor/clinic name) or an unambiguous absence. Lower this whenever the strongest evidence for "present" is a document that could plausibly be something else — most importantly, a bill/invoice/receipt that carries patient/doctor/clinic identification in its own letterhead is NOT itself a medical record just because it names those people; that specific confusion must pull this score down, not up.',
        },
        presence_reason: {
          type: ['string', 'null'],
          description:
            'One short sentence on what you actually saw that led to the presence_confidence/present values above — e.g. "Doctor\'s handwritten clinical note with a diagnosis and clinic stamp" or "Only document available is an itemized invoice/receipt — no separate clinical note, prescription, or diagnosis document". Null only if present/presence_confidence themselves could not be assessed at all.',
        },
      },
    },
    delegation_letter: {
      type: 'object',
      required: ['present', 'legible', 'delegator_name', 'delegator_nrc', 'authorized_payee_name', 'authorized_payee_contact'],
      properties: {
        present: { type: 'boolean' },
        legible: { type: ['boolean', 'null'] },
        delegator_name: { type: ['string', 'null'] },
        delegator_nrc: { type: ['string', 'null'] },
        authorized_payee_name: { type: ['string', 'null'] },
        authorized_payee_contact: { type: ['string', 'null'] },
      },
    },
    documents_present: {
      type: 'object',
      required: ['has_medical_record_photo', 'has_bill_photo', 'has_customer_signature'],
      properties: {
        has_bill_photo: { type: 'boolean' },
        has_customer_signature: { type: 'boolean' },
        has_medical_record_photo: { type: 'boolean' },
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
