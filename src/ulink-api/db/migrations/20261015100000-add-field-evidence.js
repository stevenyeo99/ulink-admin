'use strict';

// SYSTEM_4 E3b (E4-08): the AI says how sure it is of what it read, why, and on which page — for the key fields only
// (the ones the checks, the member check and the IAS claim use), not all 61.
//   - field_evidence: [{ field, confidence, reason, page }] — one entry per key field it filled in.
//   - each voucher: evidence (its amount and date), line_total (its printed lines added up), vitamin_items and
//     vitamin_confidence (which items are vitamins / supplements, how sure).
// The existing fields keep their exact shape, so nothing downstream changes. Patches the live schema (unlike the
// earlier full rewrites) so `down` removes exactly what this adds.

const ROUTE_KEY = 'ayas_member_claim';

const KEY_FIELDS = [
  'claimant.claimant_name',
  'claimant.claimant_nrc_passport',
  'claimant.claimant_dob',
  'policy.policy_no',
  'claim.appointment_date',
  'claim.accident_date',
  'claim.total_claim_amount',
  'medical.hospital_or_clinic_name',
  'medical.detail_of_illness_injury',
  'medical.full_description_of_treatment',
  'bank.bank_name',
  'bank.bank_account_name',
  'bank.bank_account_number',
  'medical_record.date',
];

const CONFIDENCE = {
  type: 'number',
  description: '0.0-1.0: how sure you are the value matches what is on the document. High only for clearly printed/typed text; low for handwriting you had to guess at, a value marked [?] or "unsure" in the transcript, or one pieced together from more than one place.',
};
const REASON = { type: ['string', 'null'], description: 'One short phrase on what the value rests on — e.g. "typed on the claim form", "handwritten, last digit 1 or 7".' };
const PAGE = { type: ['string', 'null'], description: 'The transcript label of the page it was read from, exactly as written, e.g. "claim.pdf - page 2". Null if it came from more than one page or none.' };

const FIELD_EVIDENCE = {
  type: 'array',
  description: 'One entry for each of these key fields you filled in with a value (skip fields you left null). Never an entry for any other field.',
  items: {
    type: 'object',
    required: ['field', 'confidence', 'reason', 'page'],
    properties: { field: { type: 'string', enum: KEY_FIELDS }, confidence: CONFIDENCE, reason: REASON, page: PAGE },
  },
};

const VOUCHER_PROPERTIES = {
  evidence: {
    type: 'object',
    description: "How sure you are of this voucher's own amount (subtotal) and date, and where you read them.",
    required: ['confidence', 'reason', 'page'],
    properties: { confidence: CONFIDENCE, reason: REASON, page: PAGE },
  },
  line_total: {
    type: ['number', 'null'],
    description: "The voucher's printed line amounts added up by you. Null if the voucher prints no separate line amounts, or any of them is unreadable.",
  },
  vitamin_items: {
    type: 'array',
    items: { type: 'string' },
    description: 'The line items on this voucher that are vitamins or dietary/nutritional supplements, as written. Empty when none (or has_vitamin_or_supplement is not true).',
  },
  vitamin_confidence: {
    type: ['number', 'null'],
    description: '0.0-1.0: how sure you are of has_vitamin_or_supplement. Null when it is null.',
  },
};

async function updateSchema(queryInterface, change) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key',
    { replacements: { key: ROUTE_KEY } }
  );
  if (!rows.length) return; // route not seeded on this database — nothing to patch
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  change(schema, schema.properties.invoices.properties.items.items);
  await queryInterface.sequelize.query(
    'UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key',
    { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } }
  );
}

const without = (list, names) => list.filter((name) => !names.includes(name));

module.exports = {
  async up(queryInterface) {
    await updateSchema(queryInterface, (schema, voucher) => {
      schema.properties.field_evidence = FIELD_EVIDENCE;
      schema.required = [...without(schema.required, ['field_evidence']), 'field_evidence'];
      Object.assign(voucher.properties, VOUCHER_PROPERTIES);
      voucher.required = [...without(voucher.required, Object.keys(VOUCHER_PROPERTIES)), ...Object.keys(VOUCHER_PROPERTIES)];
    });
  },

  async down(queryInterface) {
    await updateSchema(queryInterface, (schema, voucher) => {
      delete schema.properties.field_evidence;
      schema.required = without(schema.required, ['field_evidence']);
      for (const name of Object.keys(VOUCHER_PROPERTIES)) delete voucher.properties[name];
      voucher.required = without(voucher.required, Object.keys(VOUCHER_PROPERTIES));
    });
  },
};
