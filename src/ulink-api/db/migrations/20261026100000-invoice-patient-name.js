'use strict';

// Owner, 2026-10-26: the document check compares the claimant name on the claim form with the patient name on each
// voucher (INVOICE_NAME_INCONSISTENT), so the AI reads that name from every voucher. down: the field is removed.

const ROUTE_KEY = 'ayas_member_claim';

const PATIENT_NAME = {
  type: ['string', 'null'],
  description: "The patient name printed or written on this voucher, as written. Null if the voucher shows no patient name (many pharmacy receipts have none) or it is illegible. Never copy it from the claim form.",
};

async function updateVoucher(queryInterface, change) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const voucher = schema.properties?.invoices?.properties?.items?.items;
  if (!voucher?.properties?.date) throw new Error(`${ROUTE_KEY}: run 20260914110000-add-invoice-date-and-medical-record-diagnosis first`);
  change(voucher);
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

module.exports = {
  async up(queryInterface) {
    await updateVoucher(queryInterface, (voucher) => {
      voucher.properties.patient_name = PATIENT_NAME;
      voucher.required = [...new Set([...(voucher.required || []), 'patient_name'])];
    });
  },
  async down(queryInterface) {
    await updateVoucher(queryInterface, (voucher) => {
      delete voucher.properties.patient_name;
      voucher.required = (voucher.required || []).filter((field) => field !== 'patient_name');
    });
  },
};
