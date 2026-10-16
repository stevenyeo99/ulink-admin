// SYSTEM_4 F3 (E4-15 step 4): reviewer notes from past claims of the same hospital go to the mapping call as lessons —
// never a past value, never a personal field. The database is replaced here.

jest.mock('../db/models', () => ({
  Case: { findAll: jest.fn() },
  ApiCaseStep: { findAll: jest.fn(async () => []) },
  AiFeedback: { findAll: jest.fn() },
  Setting: { findAll: jest.fn(async () => []) },
}));

const { Case, AiFeedback, Setting } = require('../db/models');
const { getSettings } = require('../modules/settings/settings');
const { pastCorrectionNotes, withoutValues, MAX_NOTES } = require('../modules/ai-feedback/memory');

const fb = (id, item, extra = {}) => ({
  id, caseId: 'past1', kind: 'value', item, label: item, wrongStep: 'reading', trusted: true,
  aiValue: '900', correctedValue: '1000', reason: 'total 1,000 is bottom right, not the sub-total 900 dated 03/07/2026', ...extra,
});
const pages = ['[voucher - page 1]\nPUN HLAING  Hospital\nTotal 1000 MMK'];

beforeEach(async () => {
  Setting.findAll.mockResolvedValue([]);
  await getSettings();
  Case.findAll.mockResolvedValue([
    { id: 'past1', source: 'EMAIL', extractedFields: { medical: { hospital_or_clinic_name: 'Pun Hlaing Hospital' } } },
    { id: 'past2', source: 'EMAIL', extractedFields: { medical: { hospital_or_clinic_name: 'Other Clinic' } } },
  ]);
});

it('numbers and dates in a reason become "…"', () => {
  expect(withoutValues('total 1,000.50 on 03/07/2026 at 10:30')).toBe('total … on … at …');
  expect(withoutValues('read as January, the visit was in Jul.; ၁၂,၀၀၀ ကျပ်')).toBe('read as …, the visit was in …; … ကျပ်');
});

it('a hospital name counts only as whole words of the pages', async () => {
  AiFeedback.findAll.mockResolvedValue([fb('h', 'medical.hospital_or_clinic_name', { caseId: 'past2', aiValue: 'PHH', correctedValue: 'Other Clinic' })]);
  expect((await pastCorrectionNotes(['Receipt from ZPHHX'])).learnedFrom).toEqual([]);
});

it('same hospital only, lessons without any past value, personal fields left out', async () => {
  AiFeedback.findAll.mockResolvedValue([
    fb('a', 'claim.total_claim_amount'),
    fb('b', 'claimant.claimant_name', { reason: 'name is Aung Aung' }),
    fb('c', 'claim.appointment_date', { caseId: 'past2' }),
  ]);
  const { block, learnedFrom } = await pastCorrectionNotes(pages);

  expect(learnedFrom).toEqual([{ id: 'a', item: 'claim.total_claim_amount', label: 'Claimed amount' }]);
  expect(block).toContain('Claimed amount — the page was misread: total … is bottom right, not the sub-total … dated …');
  for (const value of ['1,000', '1000', '900', '03/07', 'Aung']) expect(block).not.toContain(value);
});

it('a name the AI first read (e.g. a short form) also counts as the same hospital', async () => {
  AiFeedback.findAll.mockResolvedValue([fb('h', 'medical.hospital_or_clinic_name', { caseId: 'past2', aiValue: 'PHH', correctedValue: 'Pun Hlaing Hospital', reason: 'PHH is the short name' })]);
  const { learnedFrom } = await pastCorrectionNotes(['Receipt from PHH']);
  expect(learnedFrom.map((l) => l.id)).toEqual(['h']);
});

it(`at most ${MAX_NOTES} notes, the same lesson once`, async () => {
  AiFeedback.findAll.mockResolvedValue([
    ...Array.from({ length: 8 }, (_, i) => fb(`n${i}`, 'claim.appointment_date', { reason: `lesson ${String.fromCharCode(97 + i)}` })),
    fb('dup', 'claim.appointment_date', { reason: 'lesson a' }),
  ]);
  const { learnedFrom } = await pastCorrectionNotes(pages);
  expect(learnedFrom).toHaveLength(MAX_NOTES);
  expect(learnedFrom.map((l) => l.id)).not.toContain('dup');
});

it('switched off: nothing is looked up', async () => {
  Setting.findAll.mockResolvedValue([{ key: 'usePastCorrections', value: false }]);
  await getSettings();
  AiFeedback.findAll.mockClear();
  expect(await pastCorrectionNotes(pages)).toEqual({ block: '', learnedFrom: [] });
  expect(AiFeedback.findAll).not.toHaveBeenCalled();
});

it("the claim's own corrections are left out, and a failed lookup reads the claim without notes", async () => {
  const { forCase } = require('../modules/llm-calls/log');
  AiFeedback.findAll.mockResolvedValue([fb('own', 'claim.appointment_date')]);
  expect((await forCase('past1', 'claim-recognition', () => pastCorrectionNotes(pages))).learnedFrom).toEqual([]);

  AiFeedback.findAll.mockRejectedValue(new Error('connection lost'));
  expect(await pastCorrectionNotes(pages)).toEqual({ block: '', learnedFrom: [] });
});
