// The benefit pick (owner, 2026-10-29): the AI sees what the documents found point to — the document check's own benefit
// type rule — so a vaccination claim gets the plan's vaccination head (OP/VACC). The AI is replaced here.

jest.mock('../db/models', () => ({ Setting: { findAll: jest.fn(async () => []) } }));
jest.mock('../modules/claim-recognition/llmClient', () => ({ synthesizeJson: jest.fn() }));

const { synthesizeJson } = require('../modules/claim-recognition/llmClient');
const { getSettings } = require('../modules/settings/settings');
const { pickBenefit } = require('../modules/ias-claim-preparation/benefitPicker');

const plans = [{ coverageLimits: [{ benefits: [
  { benefit_type_code: 'OP', benefit_type_desc: 'Outpatient', benefit_head_code: 'RX', benefit_head_desc: 'Prescribed Medicine' },
  { benefit_type_code: 'OP', benefit_type_desc: 'Outpatient', benefit_head_code: 'VACC', benefit_head_desc: 'Vaccination' },
] }] }];
const page = (kind, n) => ({ page: `claim.pdf - page ${n}`, kind, date: '2026-10-08', confidence: 0.9, reason: 'r' });

beforeEach(() => getSettings());

it('tells the AI the documents point to a vaccination, and the prompt names the vaccination head', async () => {
  synthesizeJson.mockResolvedValue({ benefitType: 'OP', benefitHead: 'VACC', confidence: 0.9, reason: 'vaccination record' });
  const fields = { claim: { type_of_patient: 'Outpatient' }, invoices: { items: [] }, document_list: [page('claim_form', 1), page('vaccination_record', 2)] };

  const result = await pickBenefit({ typeOfPatient: 'Outpatient', voucherType: 'pharmacy', fields }, plans);

  const { userText, systemPrompt } = synthesizeJson.mock.calls[0][0];
  expect(userText).toMatch(/The documents found point to: OP Outpatient \(vaccination\)/);
  expect(systemPrompt).toMatch(/vaccination head \(e\.g\. `OP` \/ `VACC`\)/);
  expect(result.pick).toEqual({ benefitType: 'OP', benefitHead: 'VACC' });
});

it('still works without the case fields (no document list)', async () => {
  synthesizeJson.mockResolvedValue({ benefitType: 'OP', benefitHead: 'RX', confidence: 0.8, reason: 'medicine' });
  await pickBenefit({ typeOfPatient: 'Outpatient', voucherType: 'pharmacy' }, plans);
  expect(synthesizeJson.mock.calls.at(-1)[0].userText).toMatch(/The documents found point to: \(no document list\)/);
});
