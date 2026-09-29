const { StpRule, StpBlockedDiagnosis } = require('../../db/models');
const { getSettings, setSettings } = require('../../modules/settings/settings');

// STP rules edited from the console Settings page — read by ias-claim-preparation/stpEligibility.js.
// A change applies to cases whose claim is prepared after it.

const bad = (res, message) => res.status(400).json({ error: { message, status: 400 } });
const notFound = (res, what) => res.status(404).json({ error: { message: `${what} not found`, status: 404 } });

const ruleView = (r) => ({
  id: r.id,
  caseSource: r.caseSource,
  benefitType: r.benefitType,
  currency: r.currency,
  stpAllowed: r.stpAllowed,
  amountLimit: r.amountLimit == null ? null : Number(r.amountLimit),
});
const diagnosisView = (d) => ({ id: d.id, codePrefix: d.codePrefix, note: d.note });

async function getStpSettings(req, res) {
  const [rules, blockedDiagnoses] = await Promise.all([
    StpRule.findAll({ order: [['caseSource', 'ASC'], ['benefitType', 'ASC']] }),
    StpBlockedDiagnosis.findAll({ order: [['codePrefix', 'ASC']] }),
  ]);
  // switches: the human-in-the-loop switches (modules/settings/settings.js).
  res.json({ rules: rules.map(ruleView), blockedDiagnoses: blockedDiagnoses.map(diagnosisView), switches: await getSettings() });
}

async function updateStpRule(req, res) {
  const { stpAllowed, amountLimit } = req.body || {};
  if (typeof stpAllowed !== 'boolean') return bad(res, 'stpAllowed must be true or false.');
  if (amountLimit !== null && !(typeof amountLimit === 'number' && Number.isFinite(amountLimit) && amountLimit >= 0)) {
    return bad(res, 'Amount limit must be a number of 0 or more, or empty.');
  }
  if (stpAllowed && amountLimit === null) return bad(res, 'Set an amount limit to allow STP.');

  const rule = await StpRule.findByPk(req.params.id);
  if (!rule) return notFound(res, 'STP rule');
  await rule.update({ stpAllowed, amountLimit });
  res.json({ rule: ruleView(rule) });
}

async function addBlockedDiagnosis(req, res) {
  const codePrefix = typeof req.body?.codePrefix === 'string' ? req.body.codePrefix.trim().toUpperCase() : '';
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
  if (!/^[A-Z][0-9A-Z.]{0,6}$/.test(codePrefix)) return bad(res, 'Enter an ICD-10 code or the start of one, e.g. C or C50.');
  if (await StpBlockedDiagnosis.findOne({ where: { codePrefix } })) return bad(res, `${codePrefix} is already on the list.`);

  const diagnosis = await StpBlockedDiagnosis.create({ codePrefix, note });
  res.status(201).json({ blockedDiagnosis: diagnosisView(diagnosis) });
}

async function removeBlockedDiagnosis(req, res) {
  const removed = await StpBlockedDiagnosis.destroy({ where: { id: req.params.id } });
  if (!removed) return notFound(res, 'Blocked diagnosis');
  res.json({ removed: true });
}

// PUT /api/stp-settings/switches — { stpBlockOnReviewPoints?, holdUnsureMissingDocsEmail? } (true/false).
async function updateSwitches(req, res) {
  try {
    res.json({ switches: await setSettings(req.body || {}, req.user.username) });
  } catch (error) {
    bad(res, error.message);
  }
}

module.exports = { getStpSettings, updateStpRule, addBlockedDiagnosis, removeBlockedDiagnosis, updateSwitches };
