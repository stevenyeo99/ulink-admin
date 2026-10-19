import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import type { OutcomeDay } from '../types/case';
import { useCaseOverview } from '../hooks/useCases';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import { SourceTabs } from '../components/common/SourceTabs';
import { pickSource, useEnabledSources } from '../hooks/useSource';
import { PipelineHealth } from '../components/common/PipelineHealth';

// Order of the cards: what needs people first, then what is moving, then outcomes.
const CARD_ORDER = ['needs_review', 'waiting_customer', 'in_progress', 'done', 'failed'];

/**
 * Dashboard home (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md): how many cases
 * need whom, for one workflow at a time — by who acts next, not by pipeline step (steps are the
 * orchestrator's view). Every number opens the Cases list filtered to exactly those cases. Which
 * numbers matter most is still an open decision (design doc, decision 3).
 */
export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const source = pickSource(params.get('source'), useEnabledSources());
  const { data: catalog } = useCaseStatuses();
  const { data, isLoading, isError } = useCaseOverview(source);

  const casesLink = (filters: Record<string, string>) => {
    // The Overview is per flow; the Cases list it opens shows that flow (its own default is All).
    const qs = new URLSearchParams({ source: source === 'API' ? 'api' : 'email', ...filters });
    return `/cases?${qs}`;
  };
  const groups = CARD_ORDER.map((id) => catalog?.groups.find((g) => g.id === id)).filter((g) => g !== undefined);

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-5">
        <SourceTabs source={source} onChange={(next) => setParams(next === 'API' ? { source: 'api' } : {}, { replace: true })} />
      </div>

      <PipelineHealth source={source} />
      {isError && <p className="mb-4 text-sm text-red-600">Couldn't load the numbers. Refresh to try again.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Link
          to={casesLink({ sort: 'createdAt' })}
          className="rounded-xl2 border border-slate-900/5 bg-white/80 p-4 shadow-glass backdrop-blur-xl hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
        >
          <p className="text-xs text-slate-500">Received today</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{isLoading ? '–' : data?.newToday ?? 0}</p>
        </Link>
        {groups.map((g) => {
          const count = data?.groups[g.id] ?? 0;
          const urgent = g.id === 'needs_review' && count > 0;
          return (
            <Link
              key={g.id}
              to={casesLink({ group: g.id })}
              className={clsx(
                'rounded-xl2 border p-4 shadow-glass backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
                urgent ? 'border-ulink-orange/40 bg-ulink-orange/10 hover:bg-ulink-orange/15' : 'border-slate-900/5 bg-white/80 hover:bg-white'
              )}
            >
              <p className={clsx('text-xs', urgent ? 'font-medium text-ulink-orange-dark' : 'text-slate-500')}>{g.label}</p>
              <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', urgent ? 'text-ulink-orange-dark' : 'text-slate-900')}>
                {isLoading ? '–' : count}
              </p>
            </Link>
          );
        })}
      </div>

      {data?.days && <OutcomeChart days={data.days} />}
    </div>
  );
}

// The four outcomes, bottom to top (ulink-api modules/case-status/catalog.js outcomeOf). Colors passed the dataviz
// palette validator (light); below 3:1 contrast, so every count is also written in the legend.
const OUTCOMES: { key: Exclude<keyof OutcomeDay, 'day'>; label: string; color: string }[] = [
  { key: 'stp', label: 'STP (paid straight through)', color: '#1baf7a' },
  { key: 'approval', label: 'Require approval (JD3)', color: '#2a78d6' },
  { key: 'incomplete', label: 'Incomplete (waiting for documents)', color: '#eb6834' },
  { key: 'processing', label: 'Being processed', color: '#cbd5e1' },
];

const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayTotal = (d: OutcomeDay) => OUTCOMES.reduce((sum, o) => sum + d[o.key], 0);
const dayText = (d: OutcomeDay) => `${dayLabel(d.day)}: ${dayTotal(d)} received — ${OUTCOMES.map((o) => `${d[o.key]} ${o.label}`).join(', ')}`;

/**
 * Claims received per day (last 14 days) and where they are now. A day's bar keeps its height; its parts move as
 * claims finish. Hover or focus a day to read its numbers.
 */
function OutcomeChart({ days }: { days: OutcomeDay[] }) {
  const [active, setActive] = useState<OutcomeDay | null>(null);
  const max = Math.max(1, ...days.map(dayTotal));
  const totals = Object.fromEntries(OUTCOMES.map((o) => [o.key, days.reduce((sum, d) => sum + d[o.key], 0)]));
  const all = OUTCOMES.reduce((sum, o) => sum + totals[o.key], 0);

  return (
    <section className="mt-6 rounded-xl2 border border-slate-900/5 bg-white/80 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-slate-800">Claims received per day — last 14 days</h2>
      <p className="mt-1 h-5 text-sm text-slate-600">{active ? dayText(active) : 'Where each day\'s claims are now. Point at a day to see its numbers.'}</p>

      {all === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No claims in the last 14 days.</p>
      ) : (
        <>
          <div className="mt-4 flex h-40 items-end gap-1.5 border-b border-slate-900/10" onMouseLeave={() => setActive(null)}>
            {days.map((d) => (
              <div
                key={d.day}
                tabIndex={0}
                aria-label={dayText(d)}
                onMouseEnter={() => setActive(d)}
                onFocus={() => setActive(d)}
                onBlur={() => setActive(null)}
                className={clsx('flex h-full flex-1 flex-col justify-end rounded-t outline-none', active?.day === d.day && 'bg-slate-900/5')}
              >
                <div className="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t" style={{ height: `${(dayTotal(d) / max) * 100}%` }}>
                  {OUTCOMES.filter((o) => d[o.key] > 0).map((o) => (
                    <div key={o.key} style={{ flexGrow: d[o.key], backgroundColor: o.color }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5 text-[11px] text-slate-500">
            {days.map((d, i) => (
              <span key={d.day} className="flex-1 text-center">
                {i % 2 === days.length % 2 ? '' : dayLabel(d.day)}
              </span>
            ))}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
            {OUTCOMES.map((o) => (
              <li key={o.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: o.color }} />
                {o.label}: <span className="font-medium tabular-nums text-slate-900">{totals[o.key]}</span>
                <span className="text-slate-500">({Math.round((totals[o.key] / all) * 100)}%)</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
