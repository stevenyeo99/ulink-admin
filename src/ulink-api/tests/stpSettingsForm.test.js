// STP settings: one form, one Save (2026-09-29). The whole form is checked first — every problem named — and
// saved all or nothing; the never-STP list is the complete list (codes left out are removed).

jest.mock('../db/models', () => ({
  sequelize: { transaction: (fn) => fn('tx') },
  StpRule: { findAll: jest.fn(), update: jest.fn() },
  StpBlockedDiagnosis: { findAll: jest.fn(), create: jest.fn() },
  Setting: { findAll: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
}));

const { StpRule, StpBlockedDiagnosis, Setting } = require('../db/models');
const { validateStpForm, saveStpSettings } = require('../controllers/stp-settings/stpSettingsController');

const rules = [
  { id: 'r1', caseSource: 'EMAIL', benefitType: 'OP', currency: 'MMK', stpAllowed: true, amountLimit: '50000' },
  { id: 'r2', caseSource: 'API', benefitType: 'IP', currency: 'MMK', stpAllowed: false, amountLimit: null },
];

beforeEach(() => jest.clearAllMocks());

describe('validateStpForm', () => {
  it('accepts a valid form and normalises the codes', () => {
    const { errors, form } = validateStpForm({
      rules: [{ id: 'r1', stpAllowed: true, amountLimit: 60000 }],
      blockedDiagnoses: [{ codePrefix: ' r69 ', note: 'Not found' }, { codePrefix: 'C50', note: '' }],
      switches: { stpBlockOnReviewPoints: true },
    }, rules);
    expect(errors).toEqual([]);
    expect(form).toEqual({
      rules: [{ id: 'r1', stpAllowed: true, amountLimit: 60000 }],
      blockedDiagnoses: [{ codePrefix: 'R69', note: 'Not found' }, { codePrefix: 'C50', note: null }],
      switches: { stpBlockOnReviewPoints: true },
    });
  });

  it('names every problem at once', () => {
    const { errors } = validateStpForm({
      rules: [{ id: 'r1', stpAllowed: true, amountLimit: null }, { id: 'r2', stpAllowed: false, amountLimit: -5 }, { id: 'nope', stpAllowed: true, amountLimit: 1 }],
      blockedDiagnoses: [{ codePrefix: 'C50' }, { codePrefix: 'c50' }, { codePrefix: '9X' }],
      switches: { somethingElse: true, holdUnsureMissingDocsEmail: 'yes' },
    }, rules);
    expect(errors).toEqual([
      'Email · OP: set a max amount to allow STP.',
      'API · IP: max amount must be a number of 0 or more, or empty.',
      'Unknown STP rule nope.',
      'C50 is on the list twice.',
      '"9X" is not an ICD-10 code or the start of one (e.g. C or C50).',
      'Unknown switch somethingElse.',
      'holdUnsureMissingDocsEmail must be on or off.',
    ]);
  });
});

describe('saveStpSettings', () => {
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
  const req = (body) => ({ body, user: { username: 'admin' } });

  it('saves nothing when any part is invalid', async () => {
    StpRule.findAll.mockResolvedValue(rules);
    const r = res();
    await saveStpSettings(req({ rules: [{ id: 'r1', stpAllowed: true, amountLimit: 70000 }], blockedDiagnoses: [{ codePrefix: '??' }] }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(StpRule.update).not.toHaveBeenCalled();
    expect(StpBlockedDiagnosis.create).not.toHaveBeenCalled();
  });

  it('saves the rules, makes the never-STP list match the form, and sets the switches — in one transaction', async () => {
    StpRule.findAll.mockResolvedValue(rules);
    const removed = { codePrefix: 'O', note: null, destroy: jest.fn() };
    const kept = { codePrefix: 'R69', note: 'Not found', update: jest.fn() };
    StpBlockedDiagnosis.findAll.mockResolvedValue([removed, kept]);

    await saveStpSettings(req({
      rules: [{ id: 'r1', stpAllowed: true, amountLimit: 70000 }],
      blockedDiagnoses: [{ codePrefix: 'R69', note: 'Not found' }, { codePrefix: 'C50', note: 'Breast cancer' }],
      switches: { stpBlockOnReviewPoints: true },
    }), res());

    expect(StpRule.update).toHaveBeenCalledWith({ stpAllowed: true, amountLimit: 70000 }, { where: { id: 'r1' }, transaction: 'tx' });
    expect(removed.destroy).toHaveBeenCalledWith({ transaction: 'tx' });
    expect(kept.update).not.toHaveBeenCalled();
    expect(StpBlockedDiagnosis.create).toHaveBeenCalledWith({ codePrefix: 'C50', note: 'Breast cancer' }, { transaction: 'tx' });
    expect(Setting.upsert).toHaveBeenCalledWith({ key: 'stpBlockOnReviewPoints', value: true, updatedBy: 'admin' }, { transaction: 'tx' });
  });
});
