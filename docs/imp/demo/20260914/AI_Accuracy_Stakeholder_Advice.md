# Stakeholder advice: AI accuracy, demo readiness, and system improvement (2026-09-16)

Context: ahead of tomorrow's demo (incomplete case + complete/STP + complete/non-STP), covering
what to tell stakeholders about LLM judgment accuracy, given the business wants this system to
eventually replace manual email/document verification and claim creation entirely.

## Core message

Position this system, for this phase, as **AI-assisted, human-verified** — not fully
autonomous. That is not a weakness to apologize for; it is the responsible way to roll out an
LLM-based pipeline that reads real handwritten receipts/clinical notes and touches bank/payment
information.

Any OCR/vision-LLM pipeline has a non-zero, **irreducible** error rate — a digit misread or a
misclassified document type is not a bug that gets patched once and disappears; it is inherent
to the technology, the same way a human data-entry clerk also mistypes occasionally. What this
system can do that a black-box system can't is **self-report when it's unsure** — that is the
real deliverable to sell tomorrow, not "zero errors."

## What we actually found this session (concrete, not hypothetical)

- **OCR/vision misread**: a handwritten lab-bill total of 176,000 was read as 196,000 (a single
  digit) — caused a false `VOUCHER_AMOUNT_MISMATCH` against the claim form's correct total of
  375,000. Confirmed by manually re-reading the source document; the true voucher sum matches
  the claim exactly.
- **Document misclassification / hallucination**: an invoice/receipt photo was misread as a
  medical record, and the model copied the claim form's own stated illness text into the
  "medical record's" diagnosis field rather than leaving it null (a case with genuinely no
  medical record submitted at all). Fixed with a deterministic check plus a confidence-scored
  second look — but the same underlying LLM behavior (confusing document types) can recur in
  other shapes.
- **False-positive risk from the first fix**: the initial fix for the case above was too broad
  and incorrectly invalidated a *genuine* medical record on a different case, because its
  diagnosis text ("Renal Colic") legitimately matched the claim form's own stated illness — an
  expected coincidence for a short, common diagnosis, not evidence of copying. Corrected by
  switching from a blind text-match rule to the model's own stated confidence score, re-asked
  narrowly when uncertain.
- **Judgment-rule gap surfaced, still open**: removing a cost-saving shortcut (so all SOP
  checks — including delegation-letter requirement — run every time, matching how the real
  human reviewer works) surfaces a real edge case: for a **child's claim**, the bank account
  is naturally in a parent's name, which the system may misread as a payee mismatch requiring
  a delegation letter. The real reviewer never asks for one in this situation, but the
  documented business rule (`20260821 Confirmed Assumptions`) has no written carve-out for
  minors either. This needs a business decision, not just a code fix — flag it to stakeholders
  as an open question, not a done consideration.

## Recommendations, in order

1. **Don't ask for 100% removal of manual work on day one.** Confidence-gated triage instead:
   high-confidence, clean cases go straight through automatically (most of the volume);
   anything below a confidence threshold, or any hard-money check (bank account mismatch),
   routes to a human reviewer with the AI's reasoning already attached. Reviewer confirms in
   seconds instead of redoing the work from scratch — still a large reduction in manual
   effort, just not zero.

2. **Reframe today's findings as evidence the safety design works, not evidence the system is
   broken.** These issues were found *because* the system exposes its work (checklist
   reasoning, confidence scores, raw extracted fields) instead of hiding behind a black-box
   approve/reject. Say that explicitly — a system that quietly gets it wrong is worse than one
   that visibly flags uncertainty.

3. **For the live demo:** if something unexpected shows up, don't explain it away — open the
   checklist panel and show *why* the system decided what it decided (confidence % and
   reasoning text). That turns a live glitch into a demonstration of the exact mechanism that
   should make stakeholders comfortable trusting more automation over time, not less.

4. **Propose a shadow-mode period** before full cutover: run the system in parallel with the
   current manual process on a defined batch of real claims, log every case where the AI's
   decision disagreed with the human reviewer's, and use that log to (a) measure real accuracy
   rather than anecdote, and (b) prioritize which checks need tightening next. This is exactly
   the workflow used to find and fix the issues above, formalized as an ongoing practice
   instead of a one-off pre-demo scramble.

5. **Name the known limitation categories explicitly**, so nothing looks hidden:
   - Vision/OCR misreads on handwritten amounts — mitigated by cross-checking (line-item sum
     vs. the voucher's own written total) but not eliminated.
   - Document misclassification (e.g. a bill mistaken for a medical record) — now has a
     confidence-based second look, still probabilistic.
   - Judgment-rule edge cases (child claims, name honorifics, unusual formats) — found and
     fixed incrementally as real cases surface them; recommend a standing, growing regression
     sample set (not a one-time hardening pass before go-live).

6. **Ask stakeholders directly** — this is their risk tolerance to set, not ours to assume:
   what confidence threshold, and which check types (bank/payment info being the obvious one),
   should *always* require human sign-off regardless of AI confidence, even once the system is
   otherwise trusted? Getting that answer in the room tomorrow gives a concrete, defensible
   scope for the next phase instead of an open-ended "make it perfect" ask.
