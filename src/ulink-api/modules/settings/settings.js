const { Setting } = require('../../db/models');

// The human-in-the-loop switches (2026-09-29). Both off until Ulink decides — with them off the system
// behaves exactly as before. Changed on the console's STP settings page (super admin).
const DEFAULTS = {
  // A claim with an open review point (the AI unsure, a possible exclusion, …) never goes STP — a
  // person checks it first (the JD3 path).
  stpBlockOnReviewPoints: false,
  // When the AI is unsure a document is missing (low confidence / unreadable), the customer's
  // missing-documents email waits for a person: send it, or override the check.
  holdUnsureMissingDocsEmail: false,
};

async function getSettings() {
  const rows = await Setting.findAll({ where: { key: Object.keys(DEFAULTS) } });
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

// Only known keys, only true/false. transaction: to save with other changes (the STP settings form).
async function setSettings(changes, updatedBy, { transaction } = {}) {
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
    if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`);
    await Setting.upsert({ key, value, updatedBy }, { transaction });
  }
}

module.exports = { getSettings, setSettings, DEFAULTS };
