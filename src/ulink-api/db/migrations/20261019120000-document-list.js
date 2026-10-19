'use strict';

// Document list (SYSTEM_4 system checklist, step 1, owner 2026-10-19): the AI gives the kind and the date of each page,
// each with its own confidence and reason, so the reviewer sees at once which documents a claim has. Information only:
// the document check shows it and never makes the case incomplete or stops it for it. Old cases have no list until
// they are read again. down: the field is removed.

const ROUTE_KEY = 'ayas_member_claim';

const KINDS = [
  'claim_form', 'voucher', 'itemized_invoice', 'consultation_note', 'discharge_summary', 'operation_or_procedure_note',
  'investigation_report', 'eye_test_slip', 'dental_consultation', 'vaccination_record', 'doctor_recommendation',
  'medical_book_cover', 'prescription', 'bank_or_id_document', 'delegation_letter', 'other',
];

const DOCUMENT_LIST = {
  type: 'array',
  description: 'One entry per transcript page, in transcript order: what kind of document the page is and the date written on it.',
  items: {
    type: 'object',
    required: ['page', 'kind', 'date', 'confidence', 'reason'],
    additionalProperties: false,
    properties: {
      page: { type: 'string', description: 'The transcript label of the page, copied exactly, e.g. "claim.pdf - page 2".' },
      kind: { type: 'string', enum: KINDS, description: 'The kind of document on this page.' },
      date: { type: ['string', 'null'], description: 'The date written on this page (YYYY-MM-DD). Null if the page shows no date.' },
      confidence: { type: ['number', 'null'], description: 'How sure you are of the kind and the date, 0.0-1.0.' },
      reason: { type: 'string', description: 'One short phrase: what on the page shows its kind, and where the date is (or that there is none).' },
    },
  },
};

async function updateSchema(queryInterface, change) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  change(schema);
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

module.exports = {
  KINDS,
  DOCUMENT_LIST,
  async up(queryInterface) {
    await updateSchema(queryInterface, (schema) => {
      schema.properties.document_list = DOCUMENT_LIST;
      if (!schema.required.includes('document_list')) schema.required.push('document_list');
    });
  },
  async down(queryInterface) {
    await updateSchema(queryInterface, (schema) => {
      delete schema.properties.document_list;
      schema.required = schema.required.filter((k) => k !== 'document_list');
    });
  },
};
