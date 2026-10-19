import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCorrection } from '../../api/casesApi';
import { Button } from '../common/Button';
import type { CorrectionOption, WrongStep } from '../../types/case';

const WRONG_STEPS: Record<WrongStep, string> = {
  reading: 'The page was misread',
  mapping: 'Read right, but put in the wrong field',
  check: "The check's decision was wrong",
};

const inputClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';

/**
 * Correct one finding where the reviewer sees it (SYSTEM_4 E4-12, in the review workspace): a value the AI read, or a
 * check's verdict set to `passed`. The value starts as the AI's; "what went wrong" starts as the usual answer (a value:
 * misread; a verdict: the check's decision) and can be changed; a reason is required — it is the audit trail and the
 * AI's learning data. Saving checks the case again, as the correction form did.
 */
export function InlineCorrection({
  caseId,
  option,
  passed,
  onDone,
}: {
  caseId: string;
  option: CorrectionOption;
  /** A verdict: the verdict to set. A value: undefined. */
  passed?: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const isVerdict = option.kind === 'verdict';
  const [value, setValue] = useState(option.current == null ? '' : String(option.current));
  const [wrongStep, setWrongStep] = useState<WrongStep>(isVerdict ? 'check' : 'reading');
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () =>
      createCorrection(caseId, {
        kind: option.kind,
        item: option.item,
        ...(isVerdict ? { passed } : { value: value.trim() }),
        reason: reason.trim(),
        wrongStep,
      }),
    onSuccess: () => {
      for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
    },
  });
  const canSave = reason.trim().length >= 3 && (isVerdict || (value.trim() !== '' && value.trim() !== String(option.current ?? ''))) && !save.isPending;

  return (
    <div className="mt-2 rounded-lg border border-ulink-orange/30 bg-ulink-orange/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {isVerdict ? (
          <p className="text-sm text-slate-700 sm:col-span-2">
            Set this check to <span className="font-semibold">{passed ? 'passed' : 'failed'}</span>
            {passed ? '.' : ' — the customer is asked for it in its approved wording.'}
          </p>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Correct value</span>
            <input
              type={option.type === 'date' ? 'date' : 'text'}
              inputMode={option.type === 'amount' ? 'decimal' : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
              autoFocus
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">What went wrong?</span>
          <select value={wrongStep} onChange={(e) => setWrongStep(e.target.value as WrongStep)} className={inputClass}>
            {Object.entries(WRONG_STEPS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. The receipt on page 3 shows 14 Aug; the AI read the 4 as a 7."
            className={inputClass}
            autoFocus={isVerdict}
          />
        </label>
      </div>
      {save.isError && <p className="mt-2 text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="mt-2 flex gap-2">
        <Button disabled={!canSave} onClick={() => save.mutate()}>Save and check again</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
