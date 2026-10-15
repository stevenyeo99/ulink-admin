'use strict';

// SYSTEM_4 E3b-2 (code review): a voucher's line_total is the AI's own recount of the voucher's total, so printed
// discount, tax and service-charge lines count too — plain item lines alone differ from the net total on a discounted
// voucher and made "Values read look valid" flag correct claims. Rewords the schema description only (the prompt,
// extract-fields.md, says the same); down puts the old wording back.

const ROUTE_KEY = 'ayas_member_claim';

const NET = "Your own recount of this voucher's total: every printed amount line added up, with printed discount lines subtracted and printed tax / service-charge lines added — the figure the printed total should equal. Null if the voucher prints no separate line amounts, or any of them is unreadable.";
const OLD = "The voucher's printed line amounts added up by you. Null if the voucher prints no separate line amounts, or any of them is unreadable.";

async function setDescription(queryInterface, description) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key',
    { replacements: { key: ROUTE_KEY } }
  );
  if (!rows.length) return; // route not seeded on this database — nothing to patch
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const lineTotal = schema.properties?.invoices?.properties?.items?.items?.properties?.line_total;
  if (!lineTotal) throw new Error(`${ROUTE_KEY}: no invoices.items line_total — run 20261015100000-add-field-evidence first`);
  lineTotal.description = description;
  await queryInterface.sequelize.query(
    'UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key',
    { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } }
  );
}

module.exports = {
  async up(queryInterface) {
    await setDescription(queryInterface, NET);
  },

  async down(queryInterface) {
    await setDescription(queryInterface, OLD);
  },
};
