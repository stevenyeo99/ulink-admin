// A correction the reviewer opened on the review page, not saved yet (InlineCorrection / FindingsPanel).
import type { CorrectionOption, WrongStep } from '../types/case';

/** One change not saved yet: a value the AI read, or a check's verdict set to `passed` (a value: passed undefined). */
export interface CorrectionDraft {
  option: CorrectionOption;
  passed?: boolean;
  value: string;
  wrongStep: WrongStep;
  reason: string;
}

// The value starts as the AI's; "what went wrong" starts as the usual answer (a value: misread; a verdict: the check's
// decision) and can be changed. wrongStep: the answer the reviewer already chose (a policy contract exclusion's two
// buttons).
export function newDraft(option: CorrectionOption, passed?: boolean, wrongStep?: WrongStep): CorrectionDraft {
  return { option, passed, value: option.current == null ? '' : String(option.current), wrongStep: wrongStep ?? (['member:balance', 'member:exclusion'].includes(option.item) ? 'exception' : option.kind === 'verdict' ? 'check' : 'reading'), reason: '' };
}

// A policy contract exclusion (SYSTEM_5 contract exclusion): the AI was wrong (it does not apply, STP stays possible), or
// it applies and the case goes on as an exception (never STP). The API takes only these two.
export const CONTRACT_EXCLUSION_ITEM = 'member:contract_exclusion';
export const CONTRACT_EXCLUSION_STEPS: Partial<Record<WrongStep, string>> = {
  check: 'It does not apply (the AI was wrong)',
  exception: 'It applies: let the case go on (the claim needs approval, never STP)',
};

/** Why the draft can't be saved yet, or null. The server checks it again (dates, amounts, choices). */
export function draftProblem(d: CorrectionDraft): string | null {
  if (d.option.kind === 'value' && (d.value.trim() === '' || d.value.trim() === String(d.option.current ?? ''))) return 'Enter the correct value';
  if (d.reason.trim().length < 3) return 'Add a reason';
  return null;
}

/** The review page's corrections not saved yet: the items as the API takes them, and how many are not ready. */
export interface PendingCorrections {
  items: ReturnType<typeof draftItem>[];
  notReady: number;
  /** One line per change, for the reviewer: "Voucher 1 date: 2025-10-08 → 2026-10-08". */
  lines: string[];
}

/** The change as a reviewer reads it. */
export function draftLine(d: CorrectionDraft): string {
  if (d.option.item === CONTRACT_EXCLUSION_ITEM) return `${d.option.label}: ${d.wrongStep === 'exception' ? 'let go on (no STP)' : 'does not apply'}`;
  if (d.option.kind === 'verdict') return `${d.option.label}: ${d.passed ? 'OK' : 'wrong'}`;
  return `${d.option.label}: ${d.option.current == null ? '(none)' : String(d.option.current)} → ${d.value.trim() || '…'}`;
}

/** The draft as the API takes it (POST /api/cases/:id/corrections/batch). */
export function draftItem(d: CorrectionDraft) {
  return {
    kind: d.option.kind,
    item: d.option.item,
    ...(d.option.kind === 'verdict' ? { passed: d.passed } : { value: d.value.trim() }),
    reason: d.reason.trim(),
    wrongStep: d.wrongStep,
  };
}
