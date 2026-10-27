'use strict';

// SYSTEM_5 hospital name (owner, 2026-10-27): the document check compares the medical record's hospital with the hospital
// on each voucher (HOSPITAL_NAME_INCONSISTENT), so the AI reads that name from every voucher again. It was removed on
// 2026-08-22 as a fabrication risk (20260822200000-simplify-invoice-items.js); the description and the prompt say to
// read it only from this voucher's own letterhead or stamp. down: the field is removed.

const ROUTE_KEY = 'ayas_member_claim';

const HOSPITAL_NAME = {
  type: ['string', 'null'],
  description: "The hospital, clinic or pharmacy name printed on this voucher, from its own letterhead or stamp, as written. Null if this voucher shows no such name or it is illegible. Never copy it from the claim form, the medical record or another voucher.",
};

async function updateVoucher(queryInterface, change) {
  const [rows] = await queryInterface.sequelize.query('SELECT extraction_schema FROM ulink_claim_routes WHERE route_key = :key', { replacements: { key: ROUTE_KEY } });
  if (!rows.length) return;
  const schema = typeof rows[0].extraction_schema === 'string' ? JSON.parse(rows[0].extraction_schema) : rows[0].extraction_schema;
  const voucher = schema.properties?.invoices?.properties?.items?.items;
  if (!voucher?.properties?.patient_name) throw new Error(`${ROUTE_KEY}: run 20261026100000-invoice-patient-name first`);
  change(voucher);
  await queryInterface.sequelize.query('UPDATE ulink_claim_routes SET extraction_schema = :schema, updated_at = now() WHERE route_key = :key', { replacements: { key: ROUTE_KEY, schema: JSON.stringify(schema) } });
}

module.exports = {
  async up(queryInterface) {
    await updateVoucher(queryInterface, (voucher) => {
      voucher.properties.hospital_or_clinic_name = HOSPITAL_NAME;
      voucher.required = [...new Set([...(voucher.required || []), 'hospital_or_clinic_name'])];
    });
  },
  async down(queryInterface) {
    await updateVoucher(queryInterface, (voucher) => {
      delete voucher.properties.hospital_or_clinic_name;
      voucher.required = (voucher.required || []).filter((field) => field !== 'hospital_or_clinic_name');
    });
  },
};
