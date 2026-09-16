const { mentionsBillLikeDocument } = require('../modules/claim-recognition/service');

// Regression test for the 2026-09-16 fix (case a5fbb7dd-7359-415c-94c5-5e9716df922b, same
// underlying document as c9430f24): presence_confidence alone was unreliable — the model
// reported confidence: 1 while its own presence_reason said "Medical record header/invoice
// from Pun Hlaing Clinic...". mentionsBillLikeDocument is the second, independent trigger
// applyMedicalRecordFallback now also checks, regardless of the confidence number.
describe('mentionsBillLikeDocument', () => {
  it('flags a reason that names the document as an invoice', () => {
    expect(mentionsBillLikeDocument('Medical record header/invoice from Pun Hlaing Clinic with patient and doctor details is present.')).toBe(true);
  });

  it('flags "bill" and "receipt" too, case-insensitively', () => {
    expect(mentionsBillLikeDocument('This looks like a BILL, not a clinical note.')).toBe(true);
    expect(mentionsBillLikeDocument('Only a payment receipt is shown, no diagnosis.')).toBe(true);
  });

  it('does not flag a genuine clinical-note description', () => {
    expect(mentionsBillLikeDocument("Doctor's handwritten clinical note with a diagnosis and clinic stamp.")).toBe(false);
  });

  it('handles null/undefined/non-string input without throwing', () => {
    expect(mentionsBillLikeDocument(null)).toBe(false);
    expect(mentionsBillLikeDocument(undefined)).toBe(false);
  });
});
