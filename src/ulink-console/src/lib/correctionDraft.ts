// A correction the reviewer opened on the review page, not saved yet (InlineCorrection / FindingsPanel).
import type { CorrectionOption, WrongStep } from '../types/case';

/** One change not saved yet: a value the AI read, or a check's verdict set to `passed` (a value: passed undefined). */
export interface CorrectionDraft {
  option: CorrectionOption;
  passed?: boolean;
  value: string;
  wrongStep: WrongStep;
  reason: string;
  /** Ask the customer (SYSTEM_5 review actions 4.9): the AI was right, the customer must send it. Saved apart from the corrections. */
  ask?: boolean;
}

// The value starts as the AI's; "what went wrong" starts as the usual answer (a value: misread; a verdict: the check's
// decision) and can be changed. wrongStep: the answer the reviewer already chose (a policy contract exclusion's two
// buttons).
export function newDraft(option: CorrectionOption, passed?: boolean, wrongStep?: WrongStep): CorrectionDraft {
  return { option, passed, value: option.current == null ? '' : String(option.current), wrongStep: wrongStep ?? defaultWrongStep(option), reason: '' };
}

/** A short balance or an exclusion in IAS (SYSTEM_5): the only action is a bypass with a reason, as an exception. */
export const isBypassItem = (item: string) => ['member:balance', 'member:exclusion'].includes(item);

/** What went wrong when the reviewer writes their own reason (no quick reason): a value was misread, a check was wrong. */
export const defaultWrongStep = (option: CorrectionOption): WrongStep => (isBypassItem(option.item) ? 'exception' : option.kind === 'verdict' ? 'check' : 'reading');

// A policy contract exclusion (SYSTEM_5 contract exclusion): the AI was wrong (it does not apply, STP stays possible), or
// it applies and the case goes on as an exception (never STP). The API takes only these two.
export const CONTRACT_EXCLUSION_ITEM = 'member:contract_exclusion';
export const CONTRACT_EXCLUSION_STEPS: Partial<Record<WrongStep, string>> = {
  check: 'It does not apply (the AI was wrong)',
  exception: 'It applies: let the case go on (the claim needs approval, never STP)',
};

// A reviewer's reason (SYSTEM_5 review actions, owner 2026-10-27): at least 10 characters, the API's MIN_REASON_LENGTH.
export const MIN_REASON_LENGTH = 10;
export const reasonProblem = (reason: string) => (reason.trim().length < MIN_REASON_LENGTH ? `Write a reason of at least ${MIN_REASON_LENGTH} characters` : null);

/** Why the draft can't be saved yet, or null. The server checks it again (dates, amounts, choices). */
export function draftProblem(d: CorrectionDraft): string | null {
  if (!d.ask && d.option.kind === 'value' && (d.value.trim() === '' || d.value.trim() === String(d.option.current ?? ''))) return 'Enter the correct value';
  return reasonProblem(d.reason);
}

/** What the reviewer is doing, in the words of the button they clicked. */
export type DraftAction = 'Mark OK' | 'Mark wrong' | 'Revise' | 'Bypass' | 'Does not apply' | 'Let it go on' | 'Ask the customer';
export function draftAction(d: CorrectionDraft): DraftAction {
  if (d.ask) return 'Ask the customer';
  if (d.option.item === CONTRACT_EXCLUSION_ITEM) return d.wrongStep === 'exception' ? 'Let it go on' : 'Does not apply';
  if (isBypassItem(d.option.item)) return 'Bypass';
  if (d.option.kind === 'value') return 'Revise';
  return d.passed ? 'Mark OK' : 'Mark wrong';
}

/** The finding's state while the draft is not saved: "Marked OK, not saved". */
export const DRAFT_STATE: Record<DraftAction, string> = {
  'Mark OK': 'Marked OK', 'Mark wrong': 'Marked wrong', Revise: 'Revised', Bypass: 'Bypassed', 'Does not apply': 'Does not apply', 'Let it go on': 'Let go on',
  'Ask the customer': 'Customer will be asked',
};

/** A ready reason: one click fills the reason box and sets what went wrong (PRD 4.3). The reviewer can add to it. */
export interface QuickReason {
  text: string;
  wrongStep: WrongStep;
}
const QUICK_REASONS: Record<DraftAction, QuickReason[]> = {
  Revise: [
    { text: 'The page shows another value. The AI misread it.', wrongStep: 'reading' },
    { text: 'The AI read the right value but put it in the wrong field.', wrongStep: 'mapping' },
  ],
  'Mark OK': [
    { text: 'The document shows that the check is wrong.', wrongStep: 'check' },
    { text: 'IAS has an old record. The claim document is right.', wrongStep: 'ias_outdated' },
    { text: 'The AI was right, but we accept it as an exception.', wrongStep: 'exception' },
  ],
  'Mark wrong': [{ text: 'The document shows that the check is wrong.', wrongStep: 'check' }],
  Bypass: [{ text: 'Accepted as an exception after review.', wrongStep: 'exception' }],
  'Does not apply': [{ text: 'The clause does not cover this claim.', wrongStep: 'check' }],
  'Let it go on': [{ text: 'The clause applies, but the case goes on for approval.', wrongStep: 'exception' }],
  'Ask the customer': [
    { text: 'The document is not attached.', wrongStep: 'check' },
    { text: 'The document is not clear enough to read.', wrongStep: 'check' },
  ],
};
export const quickReasons = (d: CorrectionDraft) => QUICK_REASONS[draftAction(d)];

/** Mark OK on a value the AI was unsure of ("The AI read it right"): saved at once, with this ready reason. */
export const CONFIRM_QUICK_REASON = 'Checked against the page: the AI read it right.';

/** The review page's corrections not saved yet: the items as the API takes them, and how many are not ready. */
export interface PendingCorrections {
  items: ReturnType<typeof draftItem>[];
  notReady: number;
  /** One line per change, for the reviewer: "Voucher 1 date: 2025-10-08 → 2026-10-08". */
  lines: string[];
}

/** The change as a reviewer reads it, with the reason. */
export function draftLine(d: CorrectionDraft): string {
  const reason = d.reason.trim() ? ` Reason: ${d.reason.trim()}` : '';
  if (d.ask) return `${d.option.label}: ask the customer.${reason}`;
  if (d.option.item === CONTRACT_EXCLUSION_ITEM) return `${d.option.label}: ${d.wrongStep === 'exception' ? 'let go on (no STP)' : 'does not apply'}.${reason}`;
  if (d.option.kind === 'verdict') return `${d.option.label}: ${draftAction(d) === 'Bypass' ? 'bypassed' : d.passed ? 'OK' : 'wrong'}.${reason}`;
  return `${d.option.label}: ${d.option.current == null ? '(none)' : String(d.option.current)} → ${d.value.trim() || '…'}.${reason}`;
}

/** Ask the customer, as the API takes it (askCustomer of the batch save). */
export const askItem = (d: CorrectionDraft) => ({ item: d.option.item, reason: d.reason.trim() });

/** A new Ask the customer draft on a failed document finding (its verdict, or the finding's own code). */
export const newAskDraft = (option: CorrectionOption): CorrectionDraft => ({ option, value: '', wrongStep: 'check', reason: '', ask: true });

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
