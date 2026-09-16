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
    expect(rendered.bodyText).not.toContain('case-123'); // Case ID lives in the subject only, not repeated in the body
    expect(rendered.bodyText).toContain('hold off replying to the customer');
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

// CLAIM_APPROVAL_REVIEW replaces the old customer-facing CLAIM_CREATED_NOTIFICATION — SOP
// §13 "ready for JD2 handover" signal, internal-only since this system can't detect JD2's
// later approval.
describe('renderClaimApprovalReview (internal-only, SOP §13)', () => {
  it('renders claim/case detail and explicitly states the customer was not notified', () => {
    const rendered = render('CLAIM_APPROVAL_REVIEW', { caseId: 'case-123', claimNo: 'CL-999' });

    expect(rendered.subject).toContain('case-123');
    expect(rendered.subject).toContain('CL-999');
    expect(rendered.bodyText).not.toContain('Dear Valued Customer');
    expect(rendered.bodyText).toContain('ready for JD2 review/approval');
    expect(rendered.bodyText).toContain('customer has NOT been told their claim number');
  });
});

// CLAIM_SUBMIT_ISSUE is internal-only for the same reason as MEMBER_VERIFY_ISSUE — the real
// IAS rejection reason is what ops needs, not the old generic customer wording.
describe('renderClaimSubmitIssue (internal-only, SOP §11)', () => {
  it('renders the real IAS rejection reason, not customer-safe wording', () => {
    const rendered = render('CLAIM_SUBMIT_ISSUE', { caseId: 'case-456', errorMessage: 'Claim already exists' });

    expect(rendered.subject).toContain('case-456');
    expect(rendered.bodyText).not.toContain('Dear Valued Customer');
    expect(rendered.bodyText).toContain('Claim already exists');
  });
});

describe('resolveRecipient', () => {
  const originalInternalReviewEmail = require('../config').emailSender.internalReviewEmail;

  afterEach(() => {
    require('../config').emailSender.internalReviewEmail = originalInternalReviewEmail;
  });

  it.each(['MEMBER_VERIFY_ISSUE', 'CLAIM_APPROVAL_REVIEW', 'CLAIM_SUBMIT_ISSUE'])(
    'routes %s to the configured internal review address, not the customer',
    (taskType) => {
      require('../config').emailSender.internalReviewEmail = 'ops@example.com';
      expect(resolveRecipient(taskType, 'customer@example.com')).toBe('ops@example.com');
    }
  );

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
