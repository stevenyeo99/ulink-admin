// The hospital name (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/HOSPITAL_NAME_PRD.md): the medical record and the invoices come from
// the hospital, so when they agree the check passes even if the claim form names another hospital, and IAS gets the
// medical record name.
jest.mock('../db/models', () => ({}));

const { judgeHospitalNames } = require('../modules/document-checking/service');
const { dedupeInvoiceItems } = require('../modules/claim-recognition/service');
const { buildPayload } = require('../modules/ias-claim-preparation/payloadBuilder');

const fields = ({ form = 'Asia Royal Hospital', record = 'Mudetar Medical Centre', vouchers = ['MUDETAR MEDICAL CENTRE'] } = {}) => ({
  medical: { hospital_or_clinic_name: form },
  medical_record: { hospital_or_clinic_name: record },
  invoices: { items: vouchers.map((hospital_or_clinic_name) => ({ hospital_or_clinic_name })) },
});
// A stand-in for entityMatch: "Asia Royal" is another hospital, every Mudetar spelling is the same one.
const match = jest.fn(async (a, b) => {
  const same = /mudetar/i.test(a) === /mudetar/i.test(b);
  return { consistent: same, confidence: same ? 0.95 : 0.9, reason: `${a} vs ${b}` };
});

beforeEach(() => match.mockClear());

it('the medical record and the vouchers agree: passes although the claim form names another hospital, and says why', async () => {
  const result = await judgeHospitalNames(fields({ vouchers: ['MUDETAR MEDICAL CENTRE', null, 'Mudetar  Medical Centre', 'Mudetar Clinic'] }), match);
  // The same name once capitals and spaces are ignored needs no AI call: only "Mudetar Clinic" is asked.
  expect(match).toHaveBeenCalledTimes(1);
  expect(match).toHaveBeenCalledWith('Mudetar Medical Centre', 'Mudetar Clinic');
  expect(result).toEqual({
    consistent: true,
    confidence: 0.95,
    reason: 'The medical record and voucher 1, 3, 4 name the same hospital ("Mudetar Medical Centre"). The claim form names "Asia Royal Hospital". The medical record name is used for IAS. Voucher 1, 3: Same name. Voucher 4: Mudetar Medical Centre vs Mudetar Clinic',
  });
});

it('a pharmacy or optical receipt is not compared: it can come from another shop', async () => {
  const f = fields({ form: 'Mudetar Medical Centre', vouchers: ['Mudetar Medical Centre', 'City Pharmacy', 'Vision Optical'] });
  f.invoices.items[1].voucher_type = 'pharmacy';
  f.invoices.items[2].voucher_type = 'optical';
  expect(await judgeHospitalNames(f, match)).toMatchObject({ consistent: true });
  expect(match).not.toHaveBeenCalled();
});

it('every AI answer too unsure to use: the claim form against the medical record, as before', async () => {
  const unsure = jest.fn(async (a, b) => (/M\.M\.C/.test(b) ? null : { consistent: false, confidence: 0.9, reason: `${a} vs ${b}` }));
  expect(await judgeHospitalNames(fields({ vouchers: ['M.M.C'] }), unsure)).toEqual({ consistent: false, confidence: 0.9, reason: 'Asia Royal Hospital vs Mudetar Medical Centre' });
});

it('the medical record and a voucher disagree: fails, naming the voucher', async () => {
  const result = await judgeHospitalNames(fields({ form: 'Mudetar Medical Centre', vouchers: ['Mudetar Medical Centre', 'Asia Royal Pharmacy'] }), match);
  expect(result).toEqual({ consistent: false, confidence: 0.9, reason: 'The medical record names "Mudetar Medical Centre". Voucher 2: Mudetar Medical Centre vs Asia Royal Pharmacy' });
});

it('no hospital on any voucher: the claim form against the medical record, as before', async () => {
  const result = await judgeHospitalNames(fields({ vouchers: [null] }), match);
  expect(match).toHaveBeenCalledWith('Asia Royal Hospital', 'Mudetar Medical Centre');
  expect(result.consistent).toBe(false);
  expect(await judgeHospitalNames(fields({ form: null, vouchers: [] }), match)).toBeNull();
});

it('no hospital on the medical record: the claim form against the vouchers', async () => {
  const result = await judgeHospitalNames(fields({ form: 'Mudetar Clinic', record: null }), match);
  expect(match).toHaveBeenCalledWith('Mudetar Clinic', 'MUDETAR MEDICAL CENTRE');
  expect(result.reason).toMatch(/^The claim form and voucher 1 name the same hospital \("Mudetar Clinic"\)\. The claim form name is used for IAS\./);
});

it('two reads of one voucher with different hospital names keep both, and each is compared', async () => {
  const read = (hospital_or_clinic_name) => ({ subtotal: 5000, voucher_type: 'consultation', date: '2026-10-01', hospital_or_clinic_name });
  const merged = dedupeInvoiceItems({ invoices: { items: [read('Mudetar Medical Centre'), read('Asia Royal Pharmacy')] } }).invoices.items;
  expect(merged).toEqual([expect.objectContaining({ hospital_or_clinic_name: 'Mudetar Medical Centre', hospital_names_read: ['Mudetar Medical Centre', 'Asia Royal Pharmacy'] })]);
  const result = await judgeHospitalNames({ ...fields(), invoices: { items: merged } }, match);
  expect(result).toMatchObject({ consistent: false, reason: 'The medical record names "Mudetar Medical Centre". Voucher 1: Mudetar Medical Centre vs Asia Royal Pharmacy' });
});

it('IAS gets the medical record hospital, else the claim form one', () => {
  const payload = (extractedFields) => buildPayload({
    extractedFields: { claim: {}, claimant: {}, policy: {}, ...extractedFields },
    iasMemberInfoResponse: { payload: { member: {}, memberPlans: [{}] } },
    route: null, diagnosis: null, receivedAt: new Date(), barcode: 'B', isStp: false, docCompleteDate: new Date(), lines: [{ subtotal: 1000, benefit: null, vitamin: null }],
  });
  expect(payload(fields()).Items[0].ProviderName).toBe('Mudetar Medical Centre');
  expect(payload({ ...fields(), medical_record: { hospital_or_clinic_name: null } }).Items[0].ProviderName).toBe('Asia Royal Hospital');
  expect(payload({ ...fields(), medical_record: { hospital_or_clinic_name: '  ' } }).Items[0].ProviderName).toBe('Asia Royal Hospital');
});
