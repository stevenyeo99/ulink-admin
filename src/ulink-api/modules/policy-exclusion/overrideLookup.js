const { PolicyHolderOverride } = require('../../db/models');
const { Op } = require('sequelize');

function norm(value) {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

/**
 * Exact/contains match on policy holder name — same style as member-verification/
 * checks.js's compareBankName, not a fuzzy/LLM judgment: this table is small and hand-
 * curated (docs/imp/demo/20260914/samples/AYAHealth_Special Conditions...xlsx), so a
 * mismatch is a real data-entry difference, not a script/transliteration variant.
 *
 * A null routeKey or policyHolderName on a stored row means "applies broadly" (mirrors the
 * source spreadsheet's own blank cells) — matches any claim's route/company respectively.
 */
async function findOverrides(companyName, routeKey) {
  const name = norm(companyName);

  const rows = await PolicyHolderOverride.findAll({
    where: { [Op.or]: [{ routeKey }, { routeKey: null }] },
  });

  if (!name) return rows.filter((row) => row.policyHolderName == null);

  return rows.filter((row) => {
    if (row.policyHolderName == null) return true;
    const stored = norm(row.policyHolderName);
    return stored === name || stored.includes(name) || name.includes(stored);
  });
}

module.exports = { findOverrides };
