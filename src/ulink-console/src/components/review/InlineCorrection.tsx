import type { WrongStep } from '../../types/case';
import { CONTRACT_EXCLUSION_ITEM, CONTRACT_EXCLUSION_STEPS, draftProblem, type CorrectionDraft } from '../../lib/correctionDraft';

const WRONG_STEPS: Record<WrongStep, string> = {
  reading: 'The page was misread',
  mapping: 'Read right, but put in the wrong field',
  check: "The check's decision was wrong",
  ias_outdated: 'IAS record is out of date',
  exception: 'AI was right, accepted as an exception',
};
// For a changed value: only a misread or a wrong field (the API refuses the exceptions there).
const VALUE_STEPS: WrongStep[] = ['reading', 'mapping'];

const inputClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';

/**
 * Correct one finding where the reviewer sees it (SYSTEM_4 E4-12, in the review workspace). A draft: nothing is saved
 * here — the panel saves every open change at once ("Save all and check again", FindingsPanel). A reason is required —
 * it is the audit trail and the AI's learning data.
 */
export function InlineCorrection({ draft, onChange, onCancel }: { draft: CorrectionDraft; onChange: (draft: CorrectionDraft) => void; onCancel: () => void }) {
  const { option, passed } = draft;
  const set = (patch: Partial<CorrectionDraft>) => onChange({ ...draft, ...patch });
  const problem = draftProblem(draft);
  // A policy contract exclusion: only its two answers (SYSTEM_5 contract exclusion).
  const contract = option.item === CONTRACT_EXCLUSION_ITEM;
  const steps = contract
    ? Object.entries(CONTRACT_EXCLUSION_STEPS)
    : Object.entries(WRONG_STEPS).filter(([id]) => draft.option.kind === 'verdict' || VALUE_STEPS.includes(id as WrongStep));

  return (
    <div className="mt-2 rounded-lg border border-ulink-orange/30 bg-ulink-orange/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {contract ? (
          <p className="text-sm text-slate-700 sm:col-span-2">Your answer on this policy contract exclusion:</p>
        ) : option.kind === 'verdict' ? (
          <p className="text-sm text-slate-700 sm:col-span-2">
            Set this check to <span className="font-semibold">{passed ? 'passed' : 'failed'}</span>
            {passed ? '.' : ' — the customer is asked for it in its approved wording.'}
          </p>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Correct value</span>
            {option.type === 'choice' ? (
              <select value={draft.value} onChange={(e) => set({ value: e.target.value })} className={inputClass}>
                {!option.choices?.includes(draft.value) && <option value={draft.value}>{draft.value || 'Choose one'}</option>}
                {option.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input
                type={option.type === 'date' ? 'date' : 'text'}
                inputMode={option.type === 'amount' ? 'decimal' : undefined}
                value={draft.value}
                onChange={(e) => set({ value: e.target.value })}
                className={inputClass}
                autoFocus
              />
            )}
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{contract ? 'Does the clause apply?' : 'What went wrong?'}</span>
          <select value={draft.wrongStep} onChange={(e) => set({ wrongStep: e.target.value as WrongStep })} className={inputClass}>
            {steps.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
          <textarea
            value={draft.reason}
            onChange={(e) => set({ reason: e.target.value })}
            rows={2}
            placeholder="e.g. The receipt on page 3 shows 14 Aug; the AI read the 4 as a 7."
            className={inputClass}
            autoFocus={option.kind === 'verdict'}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className={problem ? 'text-xs text-amber-700' : 'text-xs text-ulink-teal-dark'}>{problem ?? 'Ready — saved with the other changes'}</span>
        <button onClick={onCancel} className="text-xs text-slate-500 hover:underline">Cancel</button>
      </div>
    </div>
  );
}
