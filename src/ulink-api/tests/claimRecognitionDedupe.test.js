const { dedupeInvoiceItems } = require('../modules/claim-recognition/service');

// Regression test for the 2026-09-16 fix (case 41f3ca63-d6eb-47e0-8c1a-36a5ed1c5ffe): two
// genuinely separate vouchers sharing the same subtotal + voucher_type (a real, same-priced
// consultation package charged on two different visits) were being wrongly collapsed into
// one, silently dropping a real 57,000 voucher from the claim total.
describe('dedupeInvoiceItems', () => {
  it('keeps two same-amount, same-type vouchers separate when their dates genuinely differ', () => {
    const fields = {
      invoices: {
        present: true,
        items: [
          { subtotal: 57000, voucher_type: 'consultation', date: '2026-08-21', legible: true },
          { subtotal: 57000, voucher_type: 'consultation', date: '2026-08-28', legible: true },
        ],
      },
    };
    const result = dedupeInvoiceItems(fields);
    expect(result.invoices.items).toHaveLength(2);
    expect(result.invoices.items.map((i) => i.date)).toEqual(['2026-08-21', '2026-08-28']);
  });

  it('still collapses a genuine duplicate-scan pair (same date)', () => {
    const fields = {
      invoices: {
        present: true,
        items: [
          { subtotal: 23000, voucher_type: 'pharmacy', date: '2026-08-21', legible: true, has_clinic_stamp_or_doctor_signature: null },
          { subtotal: 23000, voucher_type: 'pharmacy', date: '2026-08-21', legible: null, has_clinic_stamp_or_doctor_signature: true },
        ],
      },
    };
    const result = dedupeInvoiceItems(fields);
    expect(result.invoices.items).toHaveLength(1);
    expect(result.invoices.items[0]).toMatchObject({ date: '2026-08-21', legible: true, has_clinic_stamp_or_doctor_signature: true });
  });

  it('still collapses a duplicate-scan pair when only one read caught the date', () => {
    const fields = {
      invoices: {
        present: true,
        items: [
          { subtotal: 23000, voucher_type: 'pharmacy', date: null, legible: true },
          { subtotal: 23000, voucher_type: 'pharmacy', date: '2026-08-21', legible: null },
        ],
      },
    };
    const result = dedupeInvoiceItems(fields);
    expect(result.invoices.items).toHaveLength(1);
    expect(result.invoices.items[0].date).toBe('2026-08-21');
  });
});
