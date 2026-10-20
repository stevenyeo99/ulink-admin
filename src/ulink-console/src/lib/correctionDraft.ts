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
// decision) and can be changed.
export function newDraft(option: CorrectionOption, passed?: boolean): CorrectionDraft {
  return { option, passed, value: option.current == null ? '' : String(option.current), wrongStep: option.kind === 'verdict' ? 'check' : 'reading', reason: '' };
}

/** Why the draft can't be saved yet, or null. The server checks it again (dates, amounts, choices). */
export function draftProblem(d: CorrectionDraft): string | null {
  if (d.option.kind === 'value' && (d.value.trim() === '' || d.value.trim() === String(d.option.current ?? ''))) return 'Enter the correct value';
  if (d.reason.trim().length < 3) return 'Add a reason';
  return null;
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
