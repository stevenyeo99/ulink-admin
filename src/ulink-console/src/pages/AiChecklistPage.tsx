import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { getAiChecklist, setCheckSwitch, type AiCheck } from '../api/aiChecklistApi';
import { isSuperAdmin } from '../lib/session';

type Filter = 'all' | 'stops';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All checks' },
  { key: 'stops', label: 'Can stop a case' },
];

// The two steps every claim goes through, in order.
const STEPS: { group: AiCheck['group']; title: string; intro: string }[] = [
  { group: 'member', title: 'Step 1: Member check', intro: "Compares the claim with the member's record in IAS. A check that can stop the case makes it wait for a person." },
  { group: 'document', title: 'Step 2: Document check', intro: 'Looks at the claim form, the vouchers, the medical record and the bank details. A check that can stop the case asks the customer for what is missing.' },
];

const EFFECT: Record<AiCheck['effect'], { label: string; className: string }> = {
  stops: { label: 'Can stop the case', className: 'bg-red-50 text-red-700' },
  warning: { label: 'Warning only', className: 'bg-amber-50 text-amber-700' },
  info: { label: 'Information', className: 'bg-slate-100 text-slate-600' },
  off: { label: 'Off in the code', className: 'bg-slate-100 text-slate-400' },
};

/**
 * AI checklist (SYSTEM_5 phase A, docs/imp/CR/SYSTEM_5/PRD/SYSTEM_5_PRD.md): every check the system runs, by the paper
 * it looks at and in the order the system runs. Each check: a plain question, what it does, what happens when it fails
 * and what a reviewer can do. Technical details (codes, case page names, checks that are off in the code) behind a
 * toggle. Read-only; the switches come in phase B. Super admin.
 */
export function AiChecklistPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['ai-checklist'], queryFn: getAiChecklist });
  const [filter, setFilter] = useState<Filter>('all');
  const [details, setDetails] = useState(false);

  const shown = (c: AiCheck) =>
    (details || c.effect !== 'off') && (filter === 'all' || c.effect === 'stops');
  const running = data?.checks.filter((c) => c.effect !== 'off') ?? [];

  return (
    <div className="mx-auto h-full w-full max-w-5xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4 max-w-3xl space-y-2 text-sm text-slate-600">
        <p>
          Every claim, from email or the API, goes through the same checks. First the <b>member check</b> compares the claim with
          the member's record in IAS. Then the <b>document check</b> looks at the claim form, the vouchers, the medical record and
          the bank details.
        </p>
        <p>
          A check that <b>can stop the case</b> sends it back: a document check asks the customer for what is missing, and a
          member check makes the case wait for a person. Whether the customer email goes out at once also depends on the
          System settings switches.
        </p>
      </div>

      {data && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Stat value={running.filter((c) => c.effect === 'stops').length} label="can stop a case" />
          <Stat value={running.filter((c) => c.locked).length} label="locked on" />
          <Stat value={running.filter((c) => !c.enabled).length} label="switched off" />
          <Stat value={running.filter((c) => c.effect === 'warning' || c.effect === 'info').length} label="only inform" />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Show" className="flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={clsx('rounded-full px-3.5 py-1.5 text-sm font-medium', filter === f.key ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          Show technical details
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">{isSuperAdmin() ? 'Could not load the checklist.' : 'Only a super admin can see the AI checklist.'}</p>}
      {data &&
        STEPS.map((step) => {
          const sections = data.sections
            .filter((s) => s.group === step.group)
            .map((s) => ({ ...s, checks: data.checks.filter((c) => c.section === s.key && shown(c)) }))
            .filter((s) => s.checks.length);
          if (!sections.length) return null;
          return (
            <div key={step.group} className="mb-8 rounded-2xl border border-slate-900/10 bg-slate-50/60 p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-slate-900">{step.title}</h2>
              <p className="mb-4 text-sm text-slate-600">{step.intro}</p>
              {sections.map((s) => (
                <section key={s.key} className="mb-5 last:mb-0">
                  <h3 className="text-base font-semibold text-slate-800">{s.title}</h3>
                  <p className="mb-2 text-sm text-slate-500">{s.intro}</p>
                  <ul className="space-y-2">
                    {s.checks.map((c) => (
                      <CheckCard key={c.code} check={c} details={details} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          );
        })}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-full border border-slate-900/10 bg-white/80 px-3 py-1 text-slate-600 shadow-glass">
      <b className="text-slate-900">{value}</b> {label}
    </span>
  );
}

function CheckCard({ check: c, details }: { check: AiCheck; details: boolean }) {
  return (
    <li className={clsx('rounded-xl2 border bg-white/80 p-4 shadow-glass', c.enabled ? 'border-slate-900/10' : 'border-amber-300', c.effect === 'off' && 'opacity-60')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="mr-auto font-medium text-slate-900">{c.question}</h4>
        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', EFFECT[c.effect].className)}>{EFFECT[c.effect].label}</span>
        {c.locked && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">Locked on</span>}
        {!c.enabled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Switched off</span>}
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-slate-500">What it does</dt>
        <dd className="text-slate-700">{c.does}</dd>
        {c.ifFails && (
          <>
            <dt className="text-slate-500">If it fails</dt>
            <dd className="text-slate-700">{c.ifFails}</dd>
          </>
        )}
        <dt className="text-slate-500">Reviewer can</dt>
        <dd className="text-slate-700">{c.reviewerCan.length ? c.reviewerCan.join(' · ') : 'Nothing'}</dd>
        {details && (
          <>
            <dt className="text-slate-500">On the case page</dt>
            <dd className="text-slate-700">{c.label}</dd>
            <dt className="text-slate-500">Code</dt>
            <dd className="font-mono text-xs text-slate-600">{c.code}</dd>
          </>
        )}
      </dl>
      <CheckSwitch check={c} />
    </li>
  );
}

/**
 * The check's switch (SYSTEM_5 phase B): off or on with a required reason; the last change (who, when, why). A check
 * that is off is skipped on cases checked from now on and shows Turned off there; while one that can stop a case is off,
 * no claim goes STP. Locked checks and information lines have no switch.
 */
function CheckSwitch({ check: c }: { check: AiCheck }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => setCheckSwitch(c.code, !c.enabled, reason.trim()),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['ai-checklist'] });
    },
  });
  const last = c.lastChange;
  if (!c.switchable && !last) return null;
  return (
    <div className="mt-3 border-t border-slate-900/5 pt-3 text-sm">
      {last && (
        <p className="mb-2 text-xs text-slate-500">
          {last.enabled ? 'Switched on' : 'Switched off'} by {last.by} on {new Date(last.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}: {last.reason}
        </p>
      )}
      {c.switchable && !open && (
        <button onClick={() => setOpen(true)} className="text-xs font-medium text-ulink-orange-dark hover:underline">
          {c.enabled ? 'Switch off' : 'Switch on'}
        </button>
      )}
      {open && (
        <div className="space-y-2">
          {c.enabled && (
            <p className="text-xs text-amber-700">
              Off: this check is skipped on cases checked from now on and shows "Turned off" there.{c.effect === 'stops' ? ' While it is off, no claim goes STP.' : ''}
            </p>
          )}
          <input
            aria-label="Reason"
            className="w-full rounded-lg border border-slate-900/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ulink-orange"
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {save.isError && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
          <div className="flex gap-2">
            <button disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-ulink-orange px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
              {save.isPending ? 'Saving…' : c.enabled ? 'Switch off' : 'Switch on'}
            </button>
            <button onClick={() => { setOpen(false); setReason(''); save.reset(); }} className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
