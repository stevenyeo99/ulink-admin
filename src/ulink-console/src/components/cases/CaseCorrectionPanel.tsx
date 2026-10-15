import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { createCorrection, trustCorrection } from '../../api/casesApi';
import { getSession, isSuperAdmin } from '../../lib/session';
import { Button } from '../common/Button';
import type { Correction, CorrectionsInfo, WrongStep } from '../../types/case';

const WRONG_STEPS: Record<WrongStep, string> = {
  reading: 'The page was misread',
  mapping: 'Read right, but put in the wrong field',
  check: "The check's decision was wrong",
};

const inputClass =
  'w-full rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20';

const shown = (v: Correction['aiValue']) => (v === true ? 'passed' : v === false ? 'failed' : v == null ? '—' : String(v));

/**
 * Correct one item (SYSTEM_4 E4-12): a value the AI read, or one check's verdict. The case is then checked again from
 * the member check with the correction; the AI's value, the correction, who and why stay visible (case history,
 * summary, IAS remark). Below: the corrections so far, and "Trusted" — a second person agrees, so the correction may
 * teach the AI later (E4-15). Whole-check override stays in the panel above for "let it through as it is".
 */
// initialItem: "value:<field>" / "verdict:<code>" to start with that item chosen (the review workspace's Correct buttons).
export function CaseCorrectionPanel({ caseId, corrections, initialItem = '' }: { caseId: string; corrections: CorrectionsInfo; initialItem?: string }) {
  const queryClient = useQueryClient();
  const [item, setItem] = useState(initialItem);
  const [value, setValue] = useState('');
  const [passed, setPassed] = useState('');
  const [wrongStep, setWrongStep] = useState<WrongStep | ''>('');
  const [reason, setReason] = useState('');

  const refresh = () => {
    for (const key of ['case', 'cases', 'review-queue', 'cases-overview', 'approvals']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  const option = corrections.options.find((o) => `${o.kind}:${o.item}` === item);
  const save = useMutation({
    mutationFn: () =>
      createCorrection(caseId, {
        kind: option!.kind,
        item: option!.item,
        ...(option!.kind === 'verdict' ? { passed: passed === 'pass' } : { value: value.trim() }),
        reason: reason.trim(),
        wrongStep: wrongStep as WrongStep,
      }),
    onSuccess: () => {
      setItem('');
      setValue('');
      setPassed('');
      setWrongStep('');
      setReason('');
      refresh();
    },
  });
  const trust = useMutation({ mutationFn: (feedbackId: string) => trustCorrection(caseId, feedbackId), onSuccess: refresh });

  const canCorrect = corrections.allowed && isSuperAdmin(); // the API requires super admin, as for override
  if (!canCorrect && corrections.list.length === 0) return null;
  const me = getSession()?.user.username;
  const canSave = option && wrongStep && reason.trim().length >= 3 && (option.kind === 'verdict' ? passed !== '' : value.trim() !== '') && !save.isPending;

  return (
    <section className="mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-slate-800">Correct one item</h2>
      {canCorrect ? (
        <>
          <p className="mb-4 mt-1 text-sm text-slate-600">
            Fix one value the AI read, or one check it got wrong. The case is then checked again with your correction; the AI's value, yours,
            your name and your reason are kept. If documents are still missing afterwards, the customer is not emailed until you send the request.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">What is wrong?</span>
              <select value={item} onChange={(e) => { setItem(e.target.value); setValue(''); setPassed(''); }} className={inputClass}>
                <option value="">Choose one</option>
                <optgroup label="A value the AI read">
                  {corrections.options.filter((o) => o.kind === 'value').map((o) => (
                    <option key={o.item} value={`value:${o.item}`}>{o.label}{o.current != null ? ` — now "${o.current}"` : ' — not read'}</option>
                  ))}
                </optgroup>
                <optgroup label="A check's verdict">
                  {corrections.options.filter((o) => o.kind === 'verdict').map((o) => (
                    <option key={o.item} value={`verdict:${o.item}`}>{o.label} — now {o.current ? 'passed' : 'failed'}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            {option && option.kind === 'value' && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Correct value</span>
                <input
                  type={option.type === 'date' ? 'date' : 'text'}
                  inputMode={option.type === 'amount' ? 'decimal' : undefined}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={option.type === 'amount' ? 'e.g. 32500' : undefined}
                  className={inputClass}
                />
              </label>
            )}
            {option && option.kind === 'verdict' && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Correct verdict</span>
                <select value={passed} onChange={(e) => setPassed(e.target.value)} className={inputClass}>
                  <option value="">Choose one</option>
                  {!option.current && <option value="pass">Passes</option>}
                  {option.current && option.canFail && <option value="fail">Fails</option>}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">What went wrong?</span>
              <select value={wrongStep} onChange={(e) => setWrongStep(e.target.value as WrongStep | '')} className={inputClass}>
                <option value="">Choose one</option>
                {Object.entries(WRONG_STEPS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">Reason</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. The receipt on page 3 shows 14 Aug; the AI read the 4 as a 7." className={inputClass} />
            </label>
          </div>
          {save.isError && <p className="mt-2 text-sm text-red-600">{(save.error as Error).message}</p>}
          <div className="mt-3">
            <Button disabled={!canSave} onClick={() => save.mutate()}>Save and check again</Button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">Corrections are made while a member or document finding holds the case.</p>
      )}

      {corrections.list.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-900/5 border-t border-slate-900/5">
          {corrections.list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div>
                <p className="text-slate-700">
                  {c.label}: AI <span className="font-medium">{shown(c.aiValue)}</span> → <span className="font-medium">{shown(c.correctedValue)}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.createdBy} — {WRONG_STEPS[c.wrongStep].toLowerCase()}: {c.reason}
                  {c.page ? ` (${c.page})` : ''}
                </p>
                {!c.applied && <p className="mt-0.5 text-xs text-amber-700">No longer applied — the case was read again (e.g. new documents). Correct it again if it still applies.</p>}
              </div>
              {c.trusted ? (
                <span className="inline-flex items-center gap-1 text-xs text-ulink-teal-dark">
                  <CheckCircle2 size={13} /> Trusted by {c.trustedBy}
                </span>
              ) : isSuperAdmin() && c.createdBy !== me ? (
                <Button variant="ghost" disabled={trust.isPending} onClick={() => trust.mutate(c.id)}>Mark trusted</Button>
              ) : (
                <span className="text-xs text-slate-400">Not trusted yet{c.createdBy === me ? ' — another person marks it' : ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
