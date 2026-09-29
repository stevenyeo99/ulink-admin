import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { getStpSettings, saveStpSettings, type StpSettings, type Switches } from '../api/stpSettingsApi';
import { SourceTabs } from '../components/common/SourceTabs';
import { Button } from '../components/common/Button';
import { isSuperAdmin } from '../lib/session';
import type { Source } from '../types/pipeline';

// IAS benefit type codes (benefit_type_code on the member's plan) — the type each claim line is submitted with.
const BENEFIT_LABELS: Record<string, string> = { IP: 'Inpatient', OP: 'Outpatient', DT: 'Dental', VS: 'Vision' };
const SOURCE_LABEL: Record<Source, string> = { EMAIL: 'Email', API: 'API' };

// When the AI itself says it is unsure, a person decides — before anything is paid, and before the
// customer is asked for documents. Both off until Ulink decides; off, the system works as before.
const SWITCHES: { key: keyof Switches; title: string; text: string }[] = [
  {
    key: 'stpBlockOnReviewPoints',
    title: "Don't pay automatically when the AI was unsure",
    text: 'A claim with an open review point (the AI unsure, a possible policy exclusion, …) never goes STP — it goes to JD3 for approval, and the STP reason says why.',
  },
  {
    key: 'holdUnsureMissingDocsEmail',
    title: "Don't email the customer when the AI is unsure a document is missing",
    text: "When the AI couldn't read a document, or wasn't sure it is missing, the customer's missing-documents email waits. The team checks, then sends the request or overrides the check.",
  },
];

const card = 'mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl';
const input =
  'rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20 disabled:bg-slate-50';
const changedMark = 'bg-ulink-orange/5 shadow-[inset_3px_0_0_0] shadow-ulink-orange';

const money = (n: number | null) => (n == null ? 'none' : n.toLocaleString('en-US'));
const onOff = (b: boolean) => (b ? 'On' : 'Off');

// The form as the user edits it: amounts as typed (text), so an empty box and a half-typed number are allowed.
interface Draft {
  rules: Record<string, { stpAllowed: boolean; amount: string }>;
  diagnoses: { codePrefix: string; note: string | null }[];
  switches: Switches;
}

function draftFrom(data: StpSettings): Draft {
  return {
    rules: Object.fromEntries(data.rules.map((r) => [r.id, { stpAllowed: r.stpAllowed, amount: r.amountLimit == null ? '' : String(r.amountLimit) }])),
    diagnoses: data.blockedDiagnoses.map((d) => ({ codePrefix: d.codePrefix, note: d.note })),
    switches: { ...data.switches },
  };
}

const parseAmount = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/**
 * STP settings (enhancement status point 7): which claims may go straight through without a person — per
 * case type (email / API) and IAS benefit type, diagnoses that never go STP, and the human-check switches.
 * One form, one Save: nothing takes effect until "Review & save", which lists every change first and saves
 * all of it or nothing. Read when a claim is prepared, so a change applies to claims prepared after it.
 */
export function StpSettingsPage() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings });

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-4 pb-28 pt-6 sm:px-6">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        A claim goes straight through (STP) only when every benefit type on it is allowed and within its limit, and its diagnosis is
        not on the never-STP list. Nothing changes until you save; changes apply to claims prepared after that.
        {!isSuperAdmin() && ' Only a super admin can change these.'}
      </p>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the STP settings.</p>}
      {/* Keyed on the loaded version: after a save (or a reload) the form starts again from what is stored. */}
      {data && <StpForm key={dataUpdatedAt} data={data} canEdit={isSuperAdmin()} />}
    </div>
  );
}

function StpForm({ data, canEdit }: { data: StpSettings; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>('EMAIL');
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Every difference from what is stored, in words — the Review & save list, and the change count.
  const changes = useMemo(() => {
    const list: { key: string; text: string; source?: Source }[] = [];
    for (const rule of data.rules) {
      const d = draft.rules[rule.id];
      const name = `${SOURCE_LABEL[rule.caseSource]} · ${rule.benefitType}`;
      if (d.stpAllowed !== rule.stpAllowed) list.push({ key: `${rule.id}-a`, source: rule.caseSource, text: `${name}: STP allowed ${rule.stpAllowed ? 'Yes' : 'No'} → ${d.stpAllowed ? 'Yes' : 'No'}` });
      if (parseAmount(d.amount) !== rule.amountLimit) list.push({ key: `${rule.id}-m`, source: rule.caseSource, text: `${name}: max amount ${money(rule.amountLimit)} → ${money(parseAmount(d.amount))} ${rule.currency}` });
    }
    const stored = data.blockedDiagnoses.map((d) => d.codePrefix);
    const drafted = draft.diagnoses.map((d) => d.codePrefix);
    for (const d of draft.diagnoses) if (!stored.includes(d.codePrefix)) list.push({ key: `+${d.codePrefix}`, text: `Never-STP diagnoses: add ${d.codePrefix}${d.note ? ` (${d.note})` : ''}` });
    for (const code of stored) if (!drafted.includes(code)) list.push({ key: `-${code}`, text: `Never-STP diagnoses: remove ${code}` });
    for (const s of SWITCHES) {
      if (draft.switches[s.key] !== data.switches[s.key]) list.push({ key: s.key, text: `"${s.title}": ${onOff(data.switches[s.key])} → ${onOff(draft.switches[s.key])}` });
    }
    return list;
  }, [data, draft]);

  // Problems the save would be refused for — shown on the row, and they block the save.
  const ruleErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const rule of data.rules) {
      const d = draft.rules[rule.id];
      const amount = parseAmount(d.amount);
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) errors[rule.id] = 'Enter a number of 0 or more.';
      else if (d.stpAllowed && amount == null) errors[rule.id] = 'Set a max amount to allow STP.';
    }
    return errors;
  }, [data, draft]);
  const errorCount = Object.keys(ruleErrors).length;
  const dirty = changes.length > 0;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => saveStpSettings({
      rules: data.rules.map((r) => ({ id: r.id, stpAllowed: draft.rules[r.id].stpAllowed, amountLimit: parseAmount(draft.rules[r.id].amount) })),
      blockedDiagnoses: draft.diagnoses,
      switches: draft.switches,
    }),
    onSuccess: (saved) => {
      setConfirmOpen(false);
      queryClient.setQueryData(['stp-settings'], saved);
    },
  });

  const setRule = (id: string, patch: Partial<Draft['rules'][string]>) =>
    setDraft((d) => ({ ...d, rules: { ...d.rules, [id]: { ...d.rules[id], ...patch } } }));
  const countFor = (s: Source) => changes.filter((c) => c.source === s).length;

  return (
    <>
      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Rules by benefit type</h2>
          <div className="flex items-center gap-3">
            {(['EMAIL', 'API'] as Source[]).filter((s) => s !== source && countFor(s) > 0).map((s) => (
              <span key={s} className="text-xs text-ulink-orange-dark">
                {SOURCE_LABEL[s]}: {countFor(s)} unsaved
              </span>
            ))}
            <SourceTabs source={source} onChange={setSource} />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2 pl-3 pr-4 font-medium">Benefit type</th>
              <th className="pb-2 pr-4 font-medium">STP allowed</th>
              <th className="pb-2 pr-3 font-medium">Max amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.filter((r) => r.caseSource === source).map((rule) => {
              const d = draft.rules[rule.id];
              const changed = d.stpAllowed !== rule.stpAllowed || parseAmount(d.amount) !== rule.amountLimit;
              return (
                <tr key={rule.id} className={clsx('border-t border-slate-900/5 align-top', changed && changedMark)}>
                  <td className="py-3 pl-3 pr-4">
                    <span className="font-medium text-slate-800">{rule.benefitType}</span>
                    <span className="ml-2 text-slate-500">{BENEFIT_LABELS[rule.benefitType] ?? ''}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={d.stpAllowed}
                        disabled={!canEdit}
                        onChange={(e) => setRule(rule.id, { stpAllowed: e.target.checked })}
                        className="h-4 w-4 accent-ulink-orange"
                      />
                      <span className="text-slate-700">{d.stpAllowed ? 'Yes' : 'No'}</span>
                    </label>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={d.amount}
                        disabled={!canEdit}
                        onChange={(e) => setRule(rule.id, { amount: e.target.value })}
                        aria-label={`Max amount for ${rule.benefitType}`}
                        aria-invalid={Boolean(ruleErrors[rule.id])}
                        className={clsx(input, 'w-36', ruleErrors[rule.id] && 'border-red-400')}
                      />
                      <span className="text-slate-500">{rule.currency}</span>
                    </div>
                    {ruleErrors[rule.id] && <p className="mt-1 text-xs text-red-600">{ruleErrors[rule.id]}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">A benefit type not listed here (e.g. PA) never goes STP.</p>
      </section>

      <NeverStpDiagnoses
        diagnoses={draft.diagnoses}
        stored={data.blockedDiagnoses.map((d) => ({ codePrefix: d.codePrefix, note: d.note }))}
        canEdit={canEdit}
        onChange={(diagnoses) => setDraft((d) => ({ ...d, diagnoses }))}
      />

      <section className={card}>
        <h2 className="text-sm font-semibold text-slate-800">Human checks when the AI is unsure</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">Applies to email and API cases.</p>
        <ul className="space-y-2">
          {SWITCHES.map((s) => (
            <li key={s.key} className={clsx('rounded-lg p-2', draft.switches[s.key] !== data.switches[s.key] && changedMark)}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={draft.switches[s.key]}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, switches: { ...d.switches, [s.key]: e.target.checked } }))}
                  className="mt-0.5 h-4 w-4 accent-ulink-orange"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{s.title}</span>
                  <span className="block text-sm text-slate-600">{s.text}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {canEdit && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-900/10 bg-white/95 px-4 py-3 shadow-glass backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{changes.length} unsaved change{changes.length > 1 ? 's' : ''}</span>
              {errorCount > 0 && <span className="ml-2 text-red-600">· fix {errorCount} problem{errorCount > 1 ? 's' : ''} first</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(draftFrom(data))}>
                Discard
              </Button>
              <Button disabled={errorCount > 0} onClick={() => setConfirmOpen(true)}>
                Review & save
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl2 bg-white p-5 shadow-glass">
            <AlertDialog.Title className="text-sm font-semibold text-slate-900">Save these STP changes?</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-3 text-sm text-slate-700">
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {changes.map((c) => (
                    <li key={c.key}>• {c.text}</li>
                  ))}
                </ul>
                <p className="mt-3 text-slate-500">They apply to claims prepared after saving. Claims already prepared keep their decision.</p>
              </div>
            </AlertDialog.Description>
            {save.isError && <p className="mt-3 text-sm text-red-600">{save.error.message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Back</Button>
              </AlertDialog.Cancel>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : `Save ${changes.length} change${changes.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function NeverStpDiagnoses({
  diagnoses,
  stored,
  canEdit,
  onChange,
}: {
  diagnoses: { codePrefix: string; note: string | null }[];
  stored: { codePrefix: string; note: string | null }[];
  canEdit: boolean;
  onChange: (diagnoses: { codePrefix: string; note: string | null }[]) => void;
}) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const normalized = code.trim().toUpperCase();
  const problem =
    normalized === '' ? null
      : !/^[A-Z][0-9A-Z.]{0,6}$/.test(normalized) ? 'Enter an ICD-10 code or the start of one, e.g. C or C50.'
        : diagnoses.some((d) => d.codePrefix === normalized) ? `${normalized} is already on the list.`
          : null;
  const removed = stored.filter((s) => !diagnoses.some((d) => d.codePrefix === s.codePrefix));
  const isStored = (codePrefix: string) => stored.some((s) => s.codePrefix === codePrefix);

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-slate-800">Diagnoses that never go STP</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        ICD-10 codes, or the start of one: <b>C</b> blocks every cancer code, <b>C50</b> only breast cancer. Applies to email and API
        cases. <b>R69</b> is the code used when the AI could not find the diagnosis.
      </p>
      <ul className="mb-4 flex flex-wrap gap-2">
        {diagnoses.map((d) => {
          const added = !isStored(d.codePrefix);
          return (
            <li key={d.codePrefix} className={clsx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm', added ? 'bg-ulink-orange/10 ring-1 ring-ulink-orange/40' : 'bg-slate-100')}>
              <span className="font-medium text-slate-800">{d.codePrefix}</span>
              {d.note && <span className="text-slate-500">{d.note}</span>}
              {added && <span className="text-xs text-ulink-orange-dark">new</span>}
              {canEdit && (
                <button
                  onClick={() => onChange(diagnoses.filter((x) => x.codePrefix !== d.codePrefix))}
                  aria-label={`Remove ${d.codePrefix}`}
                  className="text-slate-400 hover:text-red-600"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          );
        })}
        {removed.map((s) => (
          <li key={s.codePrefix} className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">
            <span className="line-through">{s.codePrefix}</span>
            <span className="text-xs">removed</span>
            {canEdit && (
              <button onClick={() => onChange([...diagnoses, s])} className="text-xs underline">
                undo
              </button>
            )}
          </li>
        ))}
        {diagnoses.length === 0 && removed.length === 0 && <li className="text-sm text-slate-500">None.</li>}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem || normalized === '') return;
            onChange([...diagnoses, { codePrefix: normalized, note: note.trim() || null }]);
            setCode('');
            setNote('');
          }}
        >
          <div>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. C50" aria-label="ICD-10 code" className={`${input} w-36`} />
            {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" className={`${input} min-w-0 flex-1`} />
          <Button type="submit" variant="ghost" disabled={normalized === '' || Boolean(problem)}>
            Add to list
          </Button>
        </form>
      )}
    </section>
  );
}
