// The IAS claim's barcode fields from a case's console barcodes (confirmed 2026-09-24): earliest first,
// the first in `barcode`, the next five in suppBarcode1..5; unused slots null; more than six left out.
// items: [{ barcodeId, createdAt }] in any order. Used by API cases (their console submissions) and email
// cases uploaded by cl-upload (console-barcode job).

const MAX_BARCODES = 6; // barcode + suppBarcode1..5

function barcodeFields(documents) {
  const ids = [...documents]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((d) => d.barcodeId)
    .slice(0, MAX_BARCODES);
  const fields = { barcode: ids[0] ?? null };
  for (let i = 1; i < MAX_BARCODES; i += 1) fields[`suppBarcode${i}`] = ids[i] ?? null;
  return fields;
}

module.exports = { barcodeFields, MAX_BARCODES };
