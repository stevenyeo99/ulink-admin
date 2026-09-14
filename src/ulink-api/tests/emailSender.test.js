const { render } = require('../modules/email-sender/templates');
const { resolveRecipient } = require('../modules/email-sender/service');

// MEMBER_VERIFY_ISSUE is internal-only (SOP §11: "hold and verify/escalate", never a direct
// customer request) — these tests guard both halves of that: the recipient-selection logic
// (resolveRecipient) and the rendered content itself (never "Dear Valued Customer" wording,
// always states the SOP-required hold action).
describe('renderMemberVerifyIssue (internal-only, SOP §11)', () => {
  it('renders internal diagnostic detail, not customer-safe wording', () => {
    const rendered = render('MEMBER_VERIFY_ISSUE', {
      caseId: 'case-123',
      reasonCode: 'BANK_DETAILS_MISMATCH',
      reason: 'Bank account number "123" does not match IAS record "456".',
    });

    expect(rendered.subject).toContain('case-123');
    expect(rendered.subject).toContain('BANK_DETAILS_MISMATCH');
    expect(rendered.bodyText).not.toContain('Dear Valued Customer');
    expect(rendered.bodyText).toContain('Do NOT reply to the customer');
    expect(rendered.bodyText).toContain('Bank account number "123" does not match IAS record "456".');
    expect(rendered.bodyText).toContain('Hold payment-related verification');
  });

  it('maps each of the four reasonCodes to its own SOP §11 action line', () => {
    const cases = [
      ['MEMBER_NOT_FOUND', 'Hold the case and verify against IAS/member census or escalate.'],
      ['COVERAGE_NOT_ACTIVE', 'Flag for eligibility assessment/escalation.'],
      ['MEMBER_DETAILS_MISMATCH', 'Hold the case and verify against IAS/member census or escalate.'],
      ['BANK_DETAILS_MISMATCH', 'Hold payment-related verification and clarify required bank information.'],
    ];
    for (const [reasonCode, action] of cases) {
      const rendered = render('MEMBER_VERIFY_ISSUE', { caseId: 'c1', reasonCode, reason: 'detail' });
      expect(rendered.bodyText).toContain(action);
    }
  });
});

describe('resolveRecipient', () => {
  const originalInternalReviewEmail = require('../config').emailSender.internalReviewEmail;

  afterEach(() => {
    require('../config').emailSender.internalReviewEmail = originalInternalReviewEmail;
  });

  it('routes MEMBER_VERIFY_ISSUE to the configured internal review address, not the customer', () => {
    require('../config').emailSender.internalReviewEmail = 'ops@example.com';
    expect(resolveRecipient('MEMBER_VERIFY_ISSUE', 'customer@example.com')).toBe('ops@example.com');
  });

  it('throws loudly when INTERNAL_REVIEW_EMAIL is unset, rather than silently sending nowhere', () => {
    require('../config').emailSender.internalReviewEmail = null;
    expect(() => resolveRecipient('MEMBER_VERIFY_ISSUE', 'customer@example.com')).toThrow(/INTERNAL_REVIEW_EMAIL/);
  });

  it('leaves every other task type going to the customer as before', () => {
    require('../config').emailSender.internalReviewEmail = 'ops@example.com';
    expect(resolveRecipient('MISSING_DOCUMENTS', 'customer@example.com')).toBe('customer@example.com');
    expect(resolveRecipient('DOCUMENT_COMPLETE_ACK', 'customer@example.com')).toBe('customer@example.com');
  });
});
