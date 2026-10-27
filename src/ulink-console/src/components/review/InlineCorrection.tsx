import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { CONTRACT_EXCLUSION_ITEM, DRAFT_STATE, defaultWrongStep, draftAction, draftProblem, quickReasons, type CorrectionDraft } from '../../lib/correctionDraft';
import { Button } from '../common/Button';

const inputClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';

/**
 * The decision card (SYSTEM_5 review actions, docs/imp/CR/SYSTEM_5/PRD/REVIEW_ACTIONS_PRD.md 4.2): one finding's Mark OK,
 * Revise, Bypass or contract answer, where the reviewer sees it. A draft: nothing is saved here — the panel saves every
 * decision at once (FindingsPanel). A reason is required — it is the audit trail and the AI's learning data. A quick
 * reason fills the reason box and sets what went wrong; the reviewer can add to it.
 *
 * done: the card is folded to one line (the reviewer clicked Done); Change opens it again.
 */
export function InlineCorrection({ draft, onChange, onUndo, risk, customerText, done, onDone }: {
  draft: CorrectionDraft;
  onChange: (draft: CorrectionDraft) => void;
  onUndo: () => void;
  /** Risk if you mark it OK (AI checklist catalog riskIfOk): shown for Mark OK, Bypass and Let it go on. */
  risk?: string | null;
  /** Ask the customer: the sentence the customer gets (the check's approved wording). */
  customerText?: string | null;
  done: boolean;
  onDone: (done: boolean) => void;
}) {
  const { option } = draft;
  const set = (patch: Partial<CorrectionDraft>) => onChange({ ...draft, ...patch });
  const problem = draftProblem(draft);
  const action = draftAction(draft);
  const showRisk = risk && ['Mark OK', 'Bypass', 'Let it go on', 'Does not apply'].includes(action);

  if (done && !problem) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ulink-teal/30 bg-ulink-teal/5 px-3 py-2 text-sm">
        <span className="font-semibold text-ulink-teal-dark">{DRAFT_STATE[action]}, not saved</span>
        {option.kind === 'value' && !draft.ask && <span className="text-slate-700">→ "{draft.value.trim()}"</span>}
        <span className="min-w-0 flex-1 truncate text-slate-600" title={draft.reason}>Reason: {draft.reason.trim()}</span>
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>Change</Button>
        <Button size="sm" variant="ghost" onClick={onUndo}>Undo</Button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-ulink-orange/40 bg-ulink-orange/5 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-800">{action}: {option.label}</p>
      {draft.ask && (
        <p className="mb-2 rounded-lg bg-white/70 p-2 text-sm text-slate-700">
          <span className="font-semibold">The customer is asked: </span>{customerText ?? option.label}
          <span className="mt-1 block text-xs text-slate-500">Sent after the case is checked again, if this is still missing.</span>
        </p>
      )}
      {option.kind === 'value' && !draft.ask && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">The AI read</span>
            <p className="rounded-lg bg-white/70 px-2.5 py-1.5 text-sm text-slate-700">{option.current == null ? '(nothing)' : String(option.current)}</p>
          </div>
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
        </div>
      )}
      {showRisk && (
        <p className="mb-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">Risk if you mark it OK:</span> {risk}</span>
        </p>
      )}
      <p className="mb-1 text-xs font-medium text-slate-600">Why? Pick a reason, or write your own</p>
      <div className="mb-2 flex flex-wrap gap-2">
        {quickReasons(draft).map((q) => (
          <button
            key={q.text}
            type="button"
            onClick={() => set({ reason: q.text, wrongStep: q.wrongStep })}
            aria-pressed={draft.reason === q.text}
            className={clsx(
              'rounded-full border px-3 py-1 text-left text-[13px] transition-colors',
              draft.reason === q.text ? 'border-ulink-orange bg-ulink-orange/10 text-slate-900' : 'border-slate-900/15 bg-white text-slate-700 hover:border-ulink-orange/60'
            )}
          >
            {q.text}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Reason (required)</span>
        <textarea
          value={draft.reason}
          onChange={(e) => {
            // The step follows the quick reason still in the text; none left → the default (PRD 4.2.5). A contract
            // answer keeps the step of the button the reviewer clicked.
            const quick = quickReasons(draft).find((q) => e.target.value.includes(q.text));
            const keep = option.item === CONTRACT_EXCLUSION_ITEM;
            set({ reason: e.target.value, wrongStep: keep ? draft.wrongStep : quick?.wrongStep ?? defaultWrongStep(option) });
          }}
          rows={2}
          placeholder="e.g. The receipt on page 3 shows 14 Aug. The AI read the 4 as a 7."
          className={inputClass}
          autoFocus={option.kind === 'verdict'}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!!problem} onClick={() => onDone(true)}>Done</Button>
        <Button size="sm" variant="ghost" onClick={onUndo}>Cancel</Button>
        <span className={problem ? 'text-xs text-amber-700' : 'text-xs text-ulink-teal-dark'}>{problem ?? 'Ready. It is saved with the other decisions.'}</span>
      </div>
    </div>
  );
}
