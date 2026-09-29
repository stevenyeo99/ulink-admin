import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { addBlockedDiagnosis, getStpSettings, removeBlockedDiagnosis, updateStpRule, updateSwitches, type StpRule, type Switches } from '../api/stpSettingsApi';
import { SourceTabs } from '../components/common/SourceTabs';
import { Button } from '../components/common/Button';
import { isSuperAdmin } from '../lib/session';
import type { Source } from '../types/pipeline';

// IAS benefit type codes (benefit_type_code on the member's plan) — the type each claim line is submitted with.
const BENEFIT_LABELS: Record<string, string> = { IP: 'Inpatient', OP: 'Outpatient', DT: 'Dental', VS: 'Vision' };

const card = 'mb-6 rounded-xl2 border border-slate-900/10 bg-white/80 p-5 shadow-glass backdrop-blur-xl';
const input =
  'rounded-lg border border-slate-900/10 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-ulink-orange focus:ring-2 focus:ring-ulink-orange/20 disabled:bg-slate-50';

/**
 * STP settings (enhancement status point 7): which claims may go straight through without a person —
 * per case type (email / API) and IAS benefit type, plus diagnoses that never go STP. Read when a
 * claim is prepared (ias-claim-preparation/stpEligibility.js), so a change applies to claims prepared after it.
 */
export function StpSettingsPage() {
  const [source, setSource] = useState<Source>('EMAIL');
  const { data, isLoading, isError } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings });
  const canEdit = isSuperAdmin();
  const rules = (data?.rules ?? []).filter((r) => r.caseSource === source);

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-4 py-6 sm:px-6">
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        A claim goes straight through (STP) only when every benefit type on it is allowed and within its limit, and its diagnosis is
        not on the never-STP list. Changes apply to claims prepared after you save.
        {!canEdit && ' Only a super admin can change these.'}
      </p>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the STP settings.</p>}

      {data && (
        <>
          <section className={card}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">Rules by benefit type</h2>
              <SourceTabs source={source} onChange={setSource} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4 font-medium">Benefit type</th>
                    <th className="pb-2 pr-4 font-medium">STP allowed</th>
                    <th className="pb-2 pr-4 font-medium">Max amount</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} canEdit={canEdit} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">A benefit type not listed here (e.g. PA) never goes STP.</p>
          </section>

          <BlockedDiagnoses items={data.blockedDiagnoses} canEdit={canEdit} />
          <HumanChecks switches={data.switches} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}

function RuleRow({ rule, canEdit }: { rule: StpRule; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState(rule.stpAllowed);
  const [limit, setLimit] = useState(rule.amountLimit == null ? '' : String(rule.amountLimit));
  const amountLimit = limit.trim() === '' ? null : Number(limit);
  const dirty = allowed !== rule.stpAllowed || amountLimit !== rule.amountLimit;

  const mutation = useMutation({
    mutationFn: () => updateStpRule(rule.id, { stpAllowed: allowed, amountLimit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stp-settings'] }),
  });

  return (
    <tr className="border-t border-slate-900/5 align-top">
      <td className="py-3 pr-4">
        <span className="font-medium text-slate-800">{rule.benefitType}</span>
        <span className="ml-2 text-slate-500">{BENEFIT_LABELS[rule.benefitType] ?? ''}</span>
      </td>
      <td className="py-3 pr-4">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowed}
            disabled={!canEdit}
            onChange={(e) => setAllowed(e.target.checked)}
            className="h-4 w-4 accent-ulink-orange"
          />
          <span className="text-slate-700">{allowed ? 'Yes' : 'No'}</span>
        </label>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            value={limit}
            disabled={!canEdit}
            onChange={(e) => setLimit(e.target.value)}
            aria-label={`Max amount for ${rule.benefitType}`}
            className={`${input} w-36`}
          />
          <span className="text-slate-500">{rule.currency}</span>
        </div>
        {mutation.isError && <p className="mt-1 text-xs text-red-600">{mutation.error.message}</p>}
      </td>
      <td className="py-3 text-right">
        {canEdit && (
          <Button variant="ghost" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </td>
    </tr>
  );
}

function BlockedDiagnoses({ items, canEdit }: { items: { id: string; codePrefix: string; note: string | null }[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['stp-settings'] });

  const add = useMutation({
    mutationFn: () => addBlockedDiagnosis(code.trim(), note.trim()),
    onSuccess: () => {
      setCode('');
      setNote('');
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: removeBlockedDiagnosis, onSuccess: refresh });

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-slate-800">Diagnoses that never go STP</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        ICD-10 codes, or the start of one: <b>C</b> blocks every cancer code, <b>C50</b> only breast cancer. Applies to email and API
        cases. <b>R69</b> is the code used when the AI could not find the diagnosis.
      </p>
      <ul className="mb-4 flex flex-wrap gap-2">
        {items.map((d) => (
          <li key={d.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm">
            <span className="font-medium text-slate-800">{d.codePrefix}</span>
            {d.note && <span className="text-slate-500">{d.note}</span>}
            {canEdit && (
              <button
                onClick={() => remove.mutate(d.id)}
                disabled={remove.isPending}
                aria-label={`Remove ${d.codePrefix}`}
                className="text-slate-400 hover:text-red-600"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-slate-500">None.</li>}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. C50" aria-label="ICD-10 code" className={`${input} w-36`} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" className={`${input} min-w-0 flex-1`} />
          <Button type="submit" disabled={code.trim() === '' || add.isPending}>
            Add
          </Button>
        </form>
      )}
      {(add.isError || remove.isError) && <p className="mt-2 text-xs text-red-600">{(add.error ?? remove.error)?.message}</p>}
    </section>
  );
}

// When the AI itself says it is unsure, a person decides — before anything is paid, and before the
// customer is asked for documents. Both off until Ulink decides; off, the system works as before.
const SWITCHES: { key: keyof Switches; title: string; text: string }[] = [
  {
    key: 'stpBlockOnReviewPoints',
    title: "Don't pay automatically when the AI was unsure",
    text: 'A claim with an open review point (the AI unsure, a possible policy exclusion, …) never goes STP — it goes to JD2 for approval, and the STP reason says why.',
  },
  {
    key: 'holdUnsureMissingDocsEmail',
    title: "Don't email the customer when the AI is unsure a document is missing",
    text: "When the AI couldn't read a document, or wasn't sure it is missing, the customer's missing-documents email waits. The team checks, then sends the request or overrides the check.",
  },
];

function HumanChecks({ switches, canEdit }: { switches: Switches; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: updateSwitches,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stp-settings'] }),
  });

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-slate-800">Human checks when the AI is unsure</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">Applies to email and API cases. Changes apply to cases processed after you switch.</p>
      <ul className="space-y-4">
        {SWITCHES.map((s) => (
          <li key={s.key}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={switches[s.key]}
                disabled={!canEdit || mutation.isPending}
                onChange={(e) => mutation.mutate({ [s.key]: e.target.checked })}
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
      {mutation.isError && <p className="mt-2 text-xs text-red-600">{mutation.error.message}</p>}
    </section>
  );
}
