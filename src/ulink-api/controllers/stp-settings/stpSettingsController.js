const { sequelize, StpRule, StpBlockedDiagnosis } = require('../../db/models');
const { getSettings, setSettings, DEFAULTS } = require('../../modules/settings/settings');

// STP settings edited from the console (one form, one Save) — read by ias-claim-preparation/stpEligibility.js
// and modules/settings. A change applies to cases whose claim is prepared after it.

const bad = (res, message, errors) => res.status(400).json({ error: { message, status: 400, ...(errors ? { errors } : {}) } });

const ruleView = (r) => ({
  id: r.id,
  caseSource: r.caseSource,
  benefitType: r.benefitType,
  currency: r.currency,
  stpAllowed: r.stpAllowed,
  amountLimit: r.amountLimit == null ? null : Number(r.amountLimit),
});
const diagnosisView = (d) => ({ id: d.id, codePrefix: d.codePrefix, note: d.note });

async function settingsView() {
  const [rules, blockedDiagnoses, switches] = await Promise.all([
    StpRule.findAll({ order: [['caseSource', 'ASC'], ['benefitType', 'ASC']] }),
    StpBlockedDiagnosis.findAll({ order: [['codePrefix', 'ASC']] }),
    getSettings(),
  ]);
  return { rules: rules.map(ruleView), blockedDiagnoses: blockedDiagnoses.map(diagnosisView), switches };
}

async function getStpSettings(req, res) {
  res.json(await settingsView());
}

/**
 * Pure. Checks the whole form and returns { errors, form } — errors name the item ("Email · OP: …"), so the
 * console can show every problem at once. existingRules: the rules in the DB (the form can only change them).
 */
function validateStpForm(body, existingRules) {
  const errors = [];
  const byId = new Map(existingRules.map((r) => [r.id, r]));
  const label = (r) => `${r.caseSource === 'API' ? 'API' : 'Email'} · ${r.benefitType}`;

  const rules = [];
  for (const input of Array.isArray(body?.rules) ? body.rules : []) {
    const rule = byId.get(input?.id);
    if (!rule) { errors.push(`Unknown STP rule ${input?.id}.`); continue; }
    const { stpAllowed, amountLimit } = input;
    if (typeof stpAllowed !== 'boolean') errors.push(`${label(rule)}: STP allowed must be yes or no.`);
    else if (amountLimit !== null && !(typeof amountLimit === 'number' && Number.isFinite(amountLimit) && amountLimit >= 0)) {
      errors.push(`${label(rule)}: max amount must be a number of 0 or more, or empty.`);
    } else if (stpAllowed && amountLimit === null) errors.push(`${label(rule)}: set a max amount to allow STP.`);
    else rules.push({ id: rule.id, stpAllowed, amountLimit });
  }

  const blockedDiagnoses = [];
  const seen = new Set();
  for (const input of Array.isArray(body?.blockedDiagnoses) ? body.blockedDiagnoses : []) {
    const codePrefix = typeof input?.codePrefix === 'string' ? input.codePrefix.trim().toUpperCase() : '';
    const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim() : null;
    if (!/^[A-Z][0-9A-Z.]{0,6}$/.test(codePrefix)) errors.push(`"${input?.codePrefix ?? ''}" is not an ICD-10 code or the start of one (e.g. C or C50).`);
    else if (seen.has(codePrefix)) errors.push(`${codePrefix} is on the list twice.`);
    else { seen.add(codePrefix); blockedDiagnoses.push({ codePrefix, note }); }
  }

  const switches = {};
  for (const [key, value] of Object.entries(body?.switches || {})) {
    if (!(key in DEFAULTS)) errors.push(`Unknown switch ${key}.`);
    else if (typeof value !== 'boolean') errors.push(`${key} must be on or off.`);
    else switches[key] = value;
  }

  return { errors, form: { rules, blockedDiagnoses, switches } };
}

/**
 * PUT /api/stp-settings — the whole form: { rules: [{ id, stpAllowed, amountLimit }], blockedDiagnoses:
 * [{ codePrefix, note }] (the complete list), switches: { … } }. All or nothing: any error → nothing saved.
 */
async function saveStpSettings(req, res) {
  const { errors, form } = validateStpForm(req.body, await StpRule.findAll());
  if (errors.length) return bad(res, errors.join(' '), errors);

  await sequelize.transaction(async (transaction) => {
    for (const { id, stpAllowed, amountLimit } of form.rules) {
      await StpRule.update({ stpAllowed, amountLimit }, { where: { id }, transaction });
    }
    const keep = form.blockedDiagnoses.map((d) => d.codePrefix);
    const existing = await StpBlockedDiagnosis.findAll({ transaction });
    for (const d of existing) {
      if (!keep.includes(d.codePrefix)) await d.destroy({ transaction });
    }
    for (const d of form.blockedDiagnoses) {
      const current = existing.find((e) => e.codePrefix === d.codePrefix);
      if (!current) await StpBlockedDiagnosis.create(d, { transaction });
      else if ((current.note ?? null) !== d.note) await current.update({ note: d.note }, { transaction });
    }
    await setSettings(form.switches, req.user.username, { transaction });
  });
  res.json(await settingsView());
}

module.exports = { getStpSettings, saveStpSettings, validateStpForm };
