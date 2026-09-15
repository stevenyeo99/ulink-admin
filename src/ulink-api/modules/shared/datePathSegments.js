/**
 * yyyy/MM/dd partition key for a given date (UTC) — shared by email-intake's attachment
 * storage key and console-upload's destination folder, so both date-sharded layouts stay
 * byte-for-byte consistent without duplicating the logic.
 */
function datePathSegments(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

module.exports = { datePathSegments };
