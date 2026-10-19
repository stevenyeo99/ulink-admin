/**
 * yyyy/MM/dd partition key for a given date (UTC) — the first folder of every stored file
 * (email attachments, linked documents, API console images, case-page uploads), console-upload's
 * destination folder and the CSR folder, so one day's files are found in one place.
 */
function datePathSegments(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

module.exports = { datePathSegments };
