// Bank account number backstop (AYA-CL-26043766): the AI read "unclear" on the typed e-claim page while page 12 printed
// the number. When the AI read none, one "Account Number" in the page text fills it, marked unsure for a person.
const { fillAccountNumberFromText } = require('../modules/claim-recognition/service');

const read = (number) => ({ bank: { bank_name: 'AYA', bank_account_name: 'Saw Wai Yan', bank_account_number: number }, field_evidence: [] });
const pages = [
  '[claim.pdf - page 2]\nBank Account Name: Saw Wai Yan\nBank Account Number: unclear',
  '[claim.pdf - page 12]\nAccount Holder Name\nSaw Wai Yan\nAccount Number\n20030586211\nSignature',
];

it('fills the number from the page text, as unsure, with the page', () => {
  const fields = fillAccountNumberFromText(read(null), pages);
  expect(fields.bank.bank_account_number).toBe('20030586211');
  expect(fields.field_evidence).toEqual([expect.objectContaining({ field: 'bank.bank_account_number', page: 'claim.pdf - page 12', confidence: 0.6 })]);
});

it('leaves the field alone when the AI read a number, when two different numbers appear, or when none does', () => {
  expect(fillAccountNumberFromText(read('123456789'), pages).bank.bank_account_number).toBe('123456789');
  expect(fillAccountNumberFromText(read(null), [...pages, '[claim.pdf - page 13]\nAccount No: 9988776655']).bank.bank_account_number).toBeNull();
  expect(fillAccountNumberFromText(read(null), [pages[0]]).bank.bank_account_number).toBeNull();
  // The same number on two pages is one number.
  expect(fillAccountNumberFromText(read(null), [...pages, '[claim.pdf - page 2]\nAccount Number: 2003 0586 211']).bank.bank_account_number).toBe('20030586211');
});

it('takes the number that starts the next page when a page ends with the label (AYA-CL-26016756)', () => {
  const split = [
    '[VSQB919839.pdf - page 2]\nBank Account Name: me me win pe\nBank Account Number: unclear',
    '[VSQB919839.pdf - page 3]\n12730102104946001\nRequired Documents for Claim',
  ];
  const fields = fillAccountNumberFromText(read(null), split);
  expect(fields.bank.bank_account_number).toBe('12730102104946001');
  expect(fields.field_evidence).toEqual([expect.objectContaining({ page: 'VSQB919839.pdf - page 3', confidence: 0.6 })]);
  // A number starting a page is taken only after a page that ends with the label.
  expect(fillAccountNumberFromText(read(null), ['[a.pdf - page 1]\nBank Name: Kbz', split[1]]).bank.bank_account_number).toBeNull();
  expect(fillAccountNumberFromText(read(null), [split[0], '[a.pdf - page 3]\nTotal 66000\n12730102104946001']).bank.bank_account_number).toBeNull();
});
