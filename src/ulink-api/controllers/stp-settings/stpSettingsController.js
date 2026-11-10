const { sequelize, StpRule, StpBlockedDiagnosis, StpBlockedBenefit } = require('../../db/models');
const { getSettings, setSettings, settingError, WHOLE_NUMBERS } = require('../../modules/settings/settings');

// STP settings and System settings edited from the console (one form per page, one Save) — read by
// ias-claim-preparation/stpEligibility.js and modules/settings. A change applies to cases whose claim is prepared after it.
// Both pages use this one endpoint; each sends only its own part (System settings: switches only).

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
const benefitView = (b) => ({ id: b.id, benefitType: b.benefitType, benefitHead: b.benefitHead, note: b.note });
const benefitKey = (b) => `${b.benefitType}/${b.benefitHead}`;

async function settingsView() {
  const [rules, blockedDiagnoses, blockedBenefits, switches] = await Promise.all([
    StpRule.findAll({ order: [['caseSource', 'ASC'], ['benefitType', 'ASC']] }),
    StpBlockedDiagnosis.findAll({ order: [['codePrefix', 'ASC']] }),
    StpBlockedBenefit.findAll({ order: [['benefitType', 'ASC'], ['benefitHead', 'ASC']] }),
    getSettings(),
  ]);
  // numberRanges: the allowed range of each whole-number setting, so the form checks what the save will (SYSTEM_4 E6).
  return { rules: rules.map(ruleView), blockedDiagnoses: blockedDiagnoses.map(diagnosisView), blockedBenefits: blockedBenefits.map(benefitView), switches, numberRanges: WHOLE_NUMBERS };
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

  // Left out or null (the System settings page) → null: the never-STP list is not touched. A list, even empty,
  // replaces it; anything else is refused rather than read as an empty list (that would clear it).
  const blockedDiagnoses = body?.blockedDiagnoses == null ? null : [];
  if (blockedDiagnoses && !Array.isArray(body.blockedDiagnoses)) errors.push('The never-STP diagnoses must be a list.');
  const seen = new Set();
  for (const input of Array.isArray(body?.blockedDiagnoses) ? body.blockedDiagnoses : []) {
    const codePrefix = typeof input?.codePrefix === 'string' ? input.codePrefix.trim().toUpperCase() : '';
    const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim() : null;
    if (!/^[A-Z][0-9A-Z.]{0,6}$/.test(codePrefix)) errors.push(`"${input?.codePrefix ?? ''}" is not an ICD-10 code or the start of one (e.g. C or C50).`);
    else if (seen.has(codePrefix)) errors.push(`${codePrefix} is on the list twice.`);
    else { seen.add(codePrefix); blockedDiagnoses.push({ codePrefix, note }); }
  }

  // Never-STP benefit heads (e.g. OP/VACC): same rules as the diagnosis list — left out or null = not touched.
  const blockedBenefits = body?.blockedBenefits == null ? null : [];
  if (blockedBenefits && !Array.isArray(body.blockedBenefits)) errors.push('The never-STP benefit heads must be a list.');
  const seenBenefits = new Set();
  const code = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
  for (const input of Array.isArray(body?.blockedBenefits) ? body.blockedBenefits : []) {
    const benefit = { benefitType: code(input?.benefitType), benefitHead: code(input?.benefitHead) };
    const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim() : null;
    if (![benefit.benefitType, benefit.benefitHead].every((c) => /^[A-Z0-9_]{1,20}$/.test(c))) {
      errors.push(`"${input?.benefitType ?? ''}/${input?.benefitHead ?? ''}" is not an IAS benefit type and head (e.g. OP and VACC).`);
    } else if (seenBenefits.has(benefitKey(benefit))) errors.push(`${benefitKey(benefit)} is on the list twice.`);
    else { seenBenefits.add(benefitKey(benefit)); blockedBenefits.push({ ...benefit, note }); }
  }

  const switches = {};
  for (const [key, value] of Object.entries(body?.switches || {})) {
    const error = settingError(key, value);
    if (error) errors.push(error);
    else switches[key] = value;
  }
  // The list means nothing without its mode: a client that sends the list alone (an old console tab) could flip it.
  if ('apiPolicyRefNos' in (body?.switches || {}) && !('apiPolicyMode' in body.switches)) errors.push('apiPolicyRefNos must be saved with apiPolicyMode.');

  return { errors, form: { rules, blockedDiagnoses, blockedBenefits, switches } };
}

// A never-STP list saved as the form sent it: rows not in the form removed, new ones added, a changed note updated.
async function replaceList(Model, list, key, transaction) {
  const existing = await Model.findAll({ transaction });
  const keep = new Set(list.map(key));
  for (const row of existing) {
    if (!keep.has(key(row))) await row.destroy({ transaction });
  }
  for (const item of list) {
    const current = existing.find((row) => key(row) === key(item));
    if (!current) await Model.create(item, { transaction });
    else if ((current.note ?? null) !== item.note) await current.update({ note: item.note }, { transaction });
  }
}

/**
 * PUT /api/stp-settings — a page's form: { rules?: [{ id, stpAllowed, amountLimit }], blockedDiagnoses?:
 * [{ codePrefix, note }] and blockedBenefits?: [{ benefitType, benefitHead, note }] (each the complete list; left out =
 * unchanged), switches?: { … } }. All or nothing: any error → nothing saved.
 */
async function saveStpSettings(req, res) {
  if (['rules', 'blockedDiagnoses', 'blockedBenefits', 'switches'].every((part) => req.body?.[part] == null)) return bad(res, 'Nothing to save.');
  const { errors, form } = validateStpForm(req.body, await StpRule.findAll());
  if (errors.length) return bad(res, errors.join(' '), errors);

  await sequelize.transaction(async (transaction) => {
    for (const { id, stpAllowed, amountLimit } of form.rules) {
      await StpRule.update({ stpAllowed, amountLimit }, { where: { id }, transaction });
    }
    if (form.blockedDiagnoses) await replaceList(StpBlockedDiagnosis, form.blockedDiagnoses, (d) => d.codePrefix, transaction);
    if (form.blockedBenefits) await replaceList(StpBlockedBenefit, form.blockedBenefits, benefitKey, transaction);
    await setSettings(form.switches, req.user.username, { transaction });
  });
  res.json(await settingsView());
}

module.exports = { getStpSettings, saveStpSettings, validateStpForm };
