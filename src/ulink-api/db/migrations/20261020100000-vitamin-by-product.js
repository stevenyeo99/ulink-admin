'use strict';

// SYSTEM_4 E4-10 follow-up (owner, 2026-10-20): on AYA-CL-26041363 the AI flagged only "Chewy Vitamin C" and missed
// Minigadine-MV, Aminovit and Superkids Z, which the human found — their names do not say "vitamin". The AI now judges
// each line by what the product is, with examples of brand-name supplements and of medicines that are not supplements.
// down: back to the 2026-10-16 wording.

const ROUTE_KEY = 'ayas_member_claim';

const KIND = 'Judge each line by what the product is, not only by its name: brand-name products count when they are '
  + 'multivitamin or mineral syrups or tablets (names often end in "-MV", "Z", "Plus" or "Kids"), tonics, amino acid '
  + 'preparations, or zinc, iron, calcium, fish oil or other nutritional products. Medicines (antibiotics, painkillers, '
  + 'cough or allergy medicines, ORS / oral rehydration salts) and medical supplies are not supplements.';

const BEFORE = {
  has_vitamin_or_supplement: 'True if any line item on this voucher is a vitamin or dietary/nutritional supplement. False if the voucher is legible enough to tell none are. Null if not assessable (e.g. illegible).',
  vitamin_items: 'The line items on this voucher that are vitamins or dietary/nutritional supplements, each with its own amount. Empty when none (or has_vitamin_or_supplement is not true).',
};

const AFTER = {
  has_vitamin_or_supplement: `${BEFORE.has_vitamin_or_supplement} ${KIND}`,
  vitamin_items: `The line items on this voucher that are vitamins or dietary/nutritional supplements, each with its own amount — every such line, not only the first. ${KIND} Empty when none (or has_vitamin_or_supplement is not true).`,
};

async function setDescriptions(queryInterface, descriptions) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const voucher = schema.properties?.invoices?.properties?.items?.items;
  if (!voucher?.properties?.vitamin_items) throw new Error(`${ROUTE_KEY}: run 20261016100000-vitamin-item-amounts first`);
  for (const [field, description] of Object.entries(descriptions)) voucher.properties[field] = { ...voucher.properties[field], description };
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

module.exports = {
  async up(queryInterface) {
    await setDescriptions(queryInterface, AFTER);
  },
  async down(queryInterface) {
    await setDescriptions(queryInterface, BEFORE);
  },
};
