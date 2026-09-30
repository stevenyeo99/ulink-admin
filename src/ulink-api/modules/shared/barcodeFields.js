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

const suffix = (scanId) => String(scanId).slice(String(scanId).lastIndexOf('-')); // API-AYA-CL-26031486-02 → -02
const list = (items) => items.map((b) => `${b.barcodeId} (${suffix(b.scanId)})`).join(', ');

// Words for the case journey / event log: which barcode is from our upload (scanId) and which are
// from earlier uploads of the same case number. Without a scanId (uploads before it was saved) the
// old wording: first barcode + how many supplementary.
function describeBarcodes(barcodes, scanId) {
  const [first, ...more] = barcodes;
  if (!scanId) return `barcode ${first.barcodeId}${more.length ? ` (+${more.length} supplementary)` : ''}`;
  const ours = barcodes.filter((b) => b.scanId === scanId);
  const others = barcodes.filter((b) => b.scanId !== scanId);
  const parts = [`our barcode ${list(ours)}`];
  if (others.length) parts.push(`sent to IAS with ${others.length} barcode(s) from other uploads of this case number: ${list(others)}`);
  if (barcodes.length > MAX_BARCODES) parts.push(`only the first ${MAX_BARCODES} fit in barcode + suppBarcode1-5`);
  return parts.join('; ');
}

module.exports = { barcodeFields, describeBarcodes, MAX_BARCODES };
