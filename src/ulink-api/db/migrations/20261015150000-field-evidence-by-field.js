'use strict';

// SYSTEM_4 E3b, found in the E3 check against the AI (2026-10-15): with field_evidence as an open array the local model
// fell into a loop — the same entry repeated until the token limit cut the answer mid-JSON (22,088 tokens, 8 minutes).
// It becomes an object with one fixed key per key field (null when the field was left null): a key can't repeat and the
// answer has a fixed shape. claim-recognition turns it back into the [{ field, … }] list everything else reads.
// vitamin_items gets a maxItems for the same reason. down: back to the array.

const ROUTE_KEY = 'ayas_member_claim';

const { KEY_FIELDS } = require('./20261015100000-add-field-evidence');

async function updateSchema(queryInterface, change) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const evidence = schema.properties?.field_evidence;
  const voucher = schema.properties?.invoices?.properties?.items?.items;
  if (!evidence || !voucher?.properties?.vitamin_items) throw new Error(`${ROUTE_KEY}: run 20261015100000-add-field-evidence first`);
  change(schema, voucher);
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

module.exports = {
  KEY_FIELDS,
  async up(queryInterface) {
    await updateSchema(queryInterface, (schema, voucher) => {
      if (schema.properties.field_evidence.type === 'object') return; // already keyed — running twice changes nothing
      const entry = schema.properties.field_evidence.items; // { field, confidence, reason, page }
      const value = { ...entry, required: ['confidence', 'reason', 'page'], properties: { ...entry.properties } };
      delete value.properties.field;
      schema.properties.field_evidence = {
        type: 'object',
        description: 'One entry per key field: how sure you are of the value you gave it, why, and on which page. null for a field you left null.',
        required: KEY_FIELDS,
        additionalProperties: false,
        properties: Object.fromEntries(KEY_FIELDS.map((f) => [f, { ...value, type: ['object', 'null'] }])),
      };
      voucher.properties.vitamin_items = { ...voucher.properties.vitamin_items, maxItems: 30 };
    });
  },
  async down(queryInterface) {
    await updateSchema(queryInterface, (schema, voucher) => {
      if (schema.properties.field_evidence.type === 'array') return; // already a list
      const value = Object.values(schema.properties.field_evidence.properties)[0];
      schema.properties.field_evidence = {
        type: 'array',
        description: 'One entry for each of these key fields you filled in with a value (skip fields you left null). Never an entry for any other field.',
        items: {
          type: 'object',
          required: ['field', 'confidence', 'reason', 'page'],
          properties: { field: { type: 'string', enum: KEY_FIELDS }, confidence: value.properties.confidence, reason: value.properties.reason, page: value.properties.page },
        },
      };
      delete voucher.properties.vitamin_items.maxItems;
    });
  },
};
