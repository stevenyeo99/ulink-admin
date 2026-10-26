// judgeInvoiceNames (document-checking/service.js): the claim form claimant name vs each voucher's patient name.
jest.mock('../db/models', () => ({}));

const { judgeInvoiceNames } = require('../modules/document-checking/service');

const fields = (names, isChild = false) => ({
  claimant: { claimant_name: 'Zay Yar Tun', is_claim_for_child: isChild },
  invoices: { items: names.map((patient_name) => ({ patient_name })) },
});
// A stand-in for entityMatch: "Khin Maung" is someone else, every other name matches.
const match = jest.fn(async (a, b) => ({ consistent: b !== 'Khin Maung', confidence: b === 'Khin Maung' ? 0.8 : 0.95, reason: `${a} vs ${b}` }));

beforeEach(() => match.mockClear());

it('one call per different name; a mismatch fails and names its vouchers', async () => {
  const result = await judgeInvoiceNames(fields(['ZAYAR TUN', null, 'Khin Maung', 'Khin Maung']), match);
  expect(match).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ consistent: false, confidence: 0.8, reason: 'Voucher 3, 4: Zay Yar Tun vs Khin Maung' });
});

it('every name matches: consistent', async () => {
  expect(await judgeInvoiceNames(fields(['ZAYAR TUN']), match)).toMatchObject({ consistent: true, confidence: 0.95 });
});

it('no AI call on a claim for a child, or with no name on any voucher', async () => {
  expect(await judgeInvoiceNames(fields(['Khin Maung'], true), match)).toBeNull();
  expect(await judgeInvoiceNames(fields([null, '  ']), match)).toBeNull();
  expect(match).not.toHaveBeenCalled();
});

it('names that differ only in capitals or spaces are one name, one call', async () => {
  const result = await judgeInvoiceNames(fields(['ZAYAR TUN', 'Zayar  Tun', 'zayar tun']), match);
  expect(match).toHaveBeenCalledTimes(1);
  expect(match).toHaveBeenCalledWith('Zay Yar Tun', 'ZAYAR TUN');
  expect(result.reason).toBe('Voucher 1, 2, 3: Zay Yar Tun vs ZAYAR TUN');
});

it('a voucher read with two names (patient_names_read): each name is compared', async () => {
  const merged = { claimant: { claimant_name: 'Zay Yar Tun' }, invoices: { items: [{ patient_name: 'ZAYAR TUN', patient_names_read: ['ZAYAR TUN', 'Khin Maung'] }, { patient_name: 42 }] } };
  const result = await judgeInvoiceNames(merged, match);
  expect(match).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ consistent: false, reason: 'Voucher 1: Zay Yar Tun vs Khin Maung' });
});
