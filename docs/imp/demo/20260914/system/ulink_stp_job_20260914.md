 #: 1
  Job: email-intake
  currentStatus in → out: EMAIL_RECEIVED → READY_FOR_DOCUMENT_READING
  LLM usage: None
  What kind: Pure I/O — IMAP fetch, Case/EmailThread matching, attachment storage
  ────────────────────────────────────────
  #: 2
  Job: claim-recognition
  currentStatus in → out: READY_FOR_DOCUMENT_READING → RECOGNIZED / NOT_RECOGNIZED / MANUAL_REVIEW
  LLM usage: Heavy — 1 vision call per page (transcribe-page.md) + 1 text call per case (synthesize.md)
  What kind: The one we spent this whole session on: the per-case call bundles extraction (literal fields) + judgment (identity_consistency — patient/provider/payee name matching) in one prompt. This is the
  module that caused the false-positive disables.
  ────────────────────────────────────────
  #: 3
  Job: member-verification
  currentStatus in → out: RECOGNIZED/MEMBER_REVIEW_REQUIRED → READY_FOR_DOCUMENT_CHECKING/MEMBER_REVIEW_REQUIRED
  LLM usage: Narrow, conditional — IAS lookup (no LLM) + deterministic hard/soft compares (checks.js, no LLM) + the exclusion RAG-judge I built this session (only runs if hard checks already passed)
  What kind: The exclusion check is a Tier-3/4 narrow judgment call, isolated from extraction, gated behind the deterministic checks so it never spends an LLM call on a case that's already failing for a
  simpler
  reason
  ────────────────────────────────────────
  #: 4
  Job: document-checking
  currentStatus in → out: READY_FOR_DOCUMENT_CHECKING → MEMBER_VERIFIED/INCOMPLETE
  LLM usage: None — confirmed by its own route doc: "no LLM call, no external dependency, deterministic"
  What kind: Pure Tier-2 code over already-extracted fields — this is where today's mandatory-field-completeness flags live
  ────────────────────────────────────────
  #: 5
  Job: email-sender
  currentStatus in → out: (reads ulink_email_tasks, not Case status)
  LLM usage: None
  What kind: Pure I/O — template render + SMTP send
  ────────────────────────────────────────
  #: 6
  Job: ias-claim-preparation
  currentStatus in → out: MEMBER_VERIFIED → CLAIM_PAYLOAD_PREPARED
  LLM usage: Heavy, but narrow — 2 separate single-purpose calls: diagnosisPicker (ICD-10 RAG + pick) and benefitPicker (plan-scoped candidate list + pick)
  What kind: Two independent Tier-3-shaped judgment calls, each scoped to one job (pick one code from a pre-filtered candidate list) — the pattern I mirrored for the exclusion check
  ────────────────────────────────────────
  #: 7
  Job: ias-claim-creation
  currentStatus in → out: CLAIM_PAYLOAD_PREPARED → CLAIM_CREATED/CLAIM_SUBMIT_FAILED
  LLM usage: None
  What kind: Pure I/O — real IAS API submission, non-idempotent

  The shape this reveals: LLM work clusters at two points — job 2 (one big bundled call, the fragile one) and jobs 3+6 (several small narrow calls, the pattern we've been extending). Everything in between (4,
  5, 7) and half of 3 is pure deterministic code with zero LLM involvement.

  Why the current order puts things where it does, worth knowing before you redesign it: jobs 3 and 6's LLM judgment calls both run after their block's own cheap/deterministic checks already passed —
  member-verification's exclusion-judge only fires once hard checks pass; ias-claim-preparation only runs at all once MEMBER_VERIFIED. That's deliberate cost-gating, not accidental — an LLM call never runs on
  a case that's going to be rejected for a simpler reason anyway.

  What's the reordering question you're weighing — moving something earlier/later, or consolidating some of these calls?