'use strict';

// SYSTEM_4 E4-10 follow-up (owner, 2026-10-16): the reviewer checks the itemised bill for vitamins / supplements, so the
// AI gives each vitamin / supplement line with its own amount — { name, amount } instead of the name only. Shown on the
// case, in team emails and in the IAS remark; the claimed amount is not changed (ULINK to confirm whether only these
// lines are taken off). Old cases keep their plain names; the checks read both. down: back to names.

const ROUTE_KEY = 'ayas_member_claim';

async function updateVitaminItems(queryInterface, items) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const voucher = schema.properties?.invoices?.properties?.items?.items;
  if (!voucher?.properties?.vitamin_items) throw new Error(`${ROUTE_KEY}: run 20261015100000-add-field-evidence first`);
  voucher.properties.vitamin_items = { ...voucher.properties.vitamin_items, ...items };
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

const ITEM = {
  type: 'object',
  required: ['name', 'amount'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'The line item as written on the voucher.' },
    amount: { type: ['number', 'null'], description: "This line's own amount as printed. Null if the voucher prints no amount for it, or it is unreadable." },
  },
};

module.exports = {
  ITEM,
  async up(queryInterface) {
    await updateVitaminItems(queryInterface, {
      items: ITEM,
      description: 'The line items on this voucher that are vitamins or dietary/nutritional supplements, each with its own amount. Empty when none (or has_vitamin_or_supplement is not true).',
    });
  },
  async down(queryInterface) {
    await updateVitaminItems(queryInterface, {
      items: { type: 'string' },
      description: 'The line items on this voucher that are vitamins or dietary/nutritional supplements, as written. Empty when none (or has_vitamin_or_supplement is not true).',
    });
  },
};
