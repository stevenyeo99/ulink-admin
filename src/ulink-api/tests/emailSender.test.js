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
    expect(rendered.bodyText).not.toMatch(/Case ID:/); // no case-ID data line — the ID is in the subject (and at most in the case link)
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
// The hand-over to JD3 (approval in IAS), internal-only since this system can't detect JD3's
// later approval.
describe('renderClaimApprovalReview (internal-only, SOP §13)', () => {
  it('renders claim/case detail and explicitly states the customer was not notified', () => {
    const rendered = render('CLAIM_APPROVAL_REVIEW', { caseId: 'case-123', claimNo: 'CL-999' });

    // The case is reached through the "Open this case" link (tested below), not the subject.
    expect(rendered.subject).toBe('(ULINK AI) Claim ready for review — Claim CL-999');
    expect(rendered.bodyText).not.toContain('Dear Valued Customer');
    expect(rendered.bodyText).toContain('ready for review and approval');
    expect(rendered.bodyText).toContain('before communicating the claim number to the customer');
  });
});

describe('renderClaimApprovalReview with the AI assessment (17/09 meeting, action 10)', () => {
  it('adds the assessment under the handover text, and reads as before without one', () => {
    const withAssessment = render('CLAIM_APPROVAL_REVIEW', { caseId: 'c1', claimNo: 'CL-1', assessment: '1. Member check: Verified' });
    expect(withAssessment.bodyText).toContain('AI assessment — what the system decided and why:\n\n1. Member check: Verified');

    const without = render('CLAIM_APPROVAL_REVIEW', { caseId: 'c1', claimNo: 'CL-1' });
    expect(without.bodyText).not.toContain('AI assessment');
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

describe('renderMissingDocuments (17/09 meeting, action 4)', () => {
  it('numbers each outstanding item and keeps its reason under it', () => {
    const { bodyText } = render('MISSING_DOCUMENTS', {
      issues: ['No Medical Report(s)', 'Please provide the missing claimant date of birth.\n  Reason: not on the claim form', '  '],
    });
    expect(bodyText).toContain('1. No Medical Report(s)\n2. Please provide the missing claimant date of birth.\n   Reason: not on the claim form\n\n');
    expect(bodyText).not.toContain('3.');
    expect(bodyText).not.toMatch(/^- /m);
  });
});

describe('internal emails: AI assessment and case link (17/09 meeting, action #7)', () => {
  const config = require('../config');
  const original = config.consoleUrl;
  afterEach(() => { config.consoleUrl = original; });

  it('adds the case link and the AI assessment to the member-issue and IAS-rejection emails', () => {
    config.consoleUrl = 'https://console.example';
    const member = render('MEMBER_VERIFY_ISSUE', { caseId: 'c9', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x', assessment: '1. Member check: BANK_DETAILS_MISMATCH' });
    expect(member.bodyText).toContain('Open this case: https://console.example/cases/c9');
    expect(member.bodyText).toContain('AI assessment — what the system decided and why:\n\n1. Member check: BANK_DETAILS_MISMATCH');

    const rejected = render('CLAIM_SUBMIT_ISSUE', { caseId: 'c9', errorMessage: 'Claim already exists', assessment: '1. STP: No' });
    expect(rejected.bodyText).toContain('Open this case: https://console.example/cases/c9');
    expect(rejected.bodyText).toContain('1. STP: No');
  });

  it('reads as before with no console address and no assessment', () => {
    config.consoleUrl = null;
    const member = render('MEMBER_VERIFY_ISSUE', { caseId: 'c9', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x' });
    expect(member.bodyText).not.toContain('Open this case');
    expect(member.bodyText).not.toContain('AI assessment');
  });
});

// Enhancement A2 (2026-09-29): a member hold with several problems names each one and its SOP action.
describe('renderMemberVerifyIssue with several problems', () => {
  it('lists every reason code and required action; the subject keeps the first', () => {
    const rendered = render('MEMBER_VERIFY_ISSUE', {
      caseId: 'c1',
      reasonCode: 'MEMBER_DETAILS_MISMATCH',
      reason: '1. DOB differs. 2. Bank differs.',
      issues: [{ reasonCode: 'MEMBER_DETAILS_MISMATCH' }, { reasonCode: 'BANK_DETAILS_MISMATCH' }],
    });
    expect(rendered.subject).toBe('(ULINK AI) Member verification hold — Case c1 — MEMBER_DETAILS_MISMATCH (+1 more)');
    expect(rendered.bodyText).toContain('Reason code: MEMBER_DETAILS_MISMATCH, BANK_DETAILS_MISMATCH');
    expect(rendered.bodyText).toContain('Hold payment-related verification and clarify required bank information.');

    const old = render('MEMBER_VERIFY_ISSUE', { caseId: 'c1', reasonCode: 'BANK_DETAILS_MISMATCH', reason: 'x' });
    expect(old.subject).toBe('(ULINK AI) Member verification hold — Case c1 — BANK_DETAILS_MISMATCH');
  });
});


// 17/09 meeting notes, item 4 (2026-09-29): internal copy of a missing-documents request.
describe('renderDocumentsIncomplete (internal)', () => {
  it('lists what the customer was asked for; refers to the claim when there is one', () => {
    const rendered = render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', issues: ['Medical record missing', 'Bank name unclear'], assessment: 'Why the case went this way:\n1. Received — Claim email' });
    expect(rendered.subject).toBe('(ULINK AI) Documents incomplete — Case c1 — 2 missing');
    expect(rendered.bodyText).toContain('Missing:\n1. Medical record missing\n2. Bank name unclear');
    expect(rendered.bodyText).toContain('AI assessment — what the system decided and why:\n\nWhy the case went this way:');
    expect(rendered.bodyText).not.toContain('Dear Valued Customer');

    expect(render('DOCUMENTS_INCOMPLETE', { caseId: 'c1', claimNo: '2609170003', issues: ['x'] }).subject)
      .toBe('(ULINK AI) Documents incomplete — Claim 2609170003 — 1 missing');
  });
});
