// Review actions with a reason (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/REVIEW_ACTIONS_PRD.md): a reason of at least 10
// characters for a correction or an override, and a "risk if you mark it OK" text for every check that can stop or warn.
jest.mock('../db/models', () => ({}));

const { validateCorrection, reasonLongEnough, REASON_TOO_SHORT } = require('../modules/ai-feedback/corrections');
const { catalog } = require('../modules/ai-checklist/catalog');

it('a reason needs at least 10 characters once spaces at the ends are removed', () => {
  expect(reasonLongEnough('  ok fine  ')).toBe(false);
  expect(reasonLongEnough('IAS is out')).toBe(true);
  expect(reasonLongEnough(undefined)).toBe(false);
  const options = [{ kind: 'verdict', item: 'NO_MEDICAL_REPORT', current: false, canFail: true }];
  expect(validateCorrection({ kind: 'verdict', item: 'NO_MEDICAL_REPORT', passed: true, reason: 'ok', wrongStep: 'check' }, options)).toEqual({ error: REASON_TOO_SHORT });
  expect(REASON_TOO_SHORT).toBe('Write a reason of at least 10 characters.');
});

it('every check that can stop a case or warn says the risk of marking it OK', () => {
  const checks = catalog().checks;
  expect(checks.filter((c) => ['stops', 'warning'].includes(c.effect) && !c.riskIfOk).map((c) => c.code)).toEqual([]);
  expect(checks.filter((c) => ['info', 'off'].includes(c.effect)).every((c) => c.riskIfOk === null)).toBe(true);
});

it('the benefit and claim preparation choices need a reason of at least 10 characters', () => {
  jest.isolateModules(() => {
    const { requiredComment } = require('../controllers/cases/casesController');
    const res = { status: jest.fn(() => res), json: jest.fn() };
    expect(requiredComment({ body: { comment: 'ok fine' } }, res, 'you chose these', { min: 10 })).toBeNull();
    expect(res.json.mock.calls[0][0].error.message).toBe('Write a reason of at least 10 characters: why you chose these.');
    expect(requiredComment({ body: { comment: 'The voucher shows this benefit.' } }, res, 'you chose these', { min: 10 })).toBe('The voucher shows this benefit.');
    // Elsewhere (a retry, a take-over) the old 3-character comment rule stays.
    expect(requiredComment({ body: { comment: 'ok!' } }, res, 'x')).toBe('ok!');
  });
});
