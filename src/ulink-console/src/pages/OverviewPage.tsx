import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useCaseOverview } from '../hooks/useCases';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import { SourceTabs } from '../components/common/SourceTabs';
import type { Source } from '../types/pipeline';

// Order of the cards: what needs people first, then what is moving, then outcomes.
const CARD_ORDER = ['needs_review', 'waiting_customer', 'in_progress', 'done', 'failed'];

/**
 * Dashboard home (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md): how many cases
 * are where, for one workflow at a time. Every number opens the Cases list filtered to exactly
 * those cases. Which numbers matter most is still an open decision (design doc, decision 3).
 */
export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const source: Source = params.get('source')?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  const { data: catalog } = useCaseStatuses();
  const { data, isLoading, isError } = useCaseOverview(source);

  const casesLink = (filters: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(source === 'API' ? { source: 'api' } : {}), ...filters });
    return `/cases?${qs}`;
  };
  const groups = CARD_ORDER.map((id) => catalog?.groups.find((g) => g.id === id)).filter((g) => g !== undefined);

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-5">
        <SourceTabs source={source} onChange={(next) => setParams(next === 'API' ? { source: 'api' } : {}, { replace: true })} />
      </div>

      {isError && <p className="mb-4 text-sm text-red-600">Couldn't load the numbers. Refresh to try again.</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      <section className="overflow-hidden rounded-xl2 border border-slate-900/5 bg-white/80 shadow-glass backdrop-blur-xl">
        <h2 className="border-b border-slate-900/5 px-5 py-3 text-sm font-semibold text-slate-800">Cases by step</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-900/5 text-xs text-slate-500">
                <th scope="col" className="px-5 py-2.5 font-medium">Step</th>
                {groups.map((g) => (
                  <th key={g.id} scope="col" className="px-5 py-2.5 text-right font-medium">
                    {g.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog?.modules.map((m) => (
                <tr key={m.id} className="border-b border-slate-900/5 last:border-0">
                  <th scope="row" className="px-5 py-2.5 font-medium text-slate-700">
                    <Link to={casesLink({ module: m.id })} className="rounded hover:text-ulink-teal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60">
                      {m.label}
                    </Link>
                  </th>
                  {groups.map((g) => {
                    const count = data?.modules[m.id]?.[g.id] ?? 0;
                    return (
                      <td key={g.id} className="px-5 py-2.5 text-right tabular-nums">
                        {count > 0 ? (
                          <Link
                            to={casesLink({ module: m.id, group: g.id })}
                            className={clsx(
                              'rounded px-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
                              g.id === 'needs_review' ? 'text-ulink-orange-dark' : 'text-slate-800 hover:text-ulink-teal-dark'
                            )}
                          >
                            {count}
                          </Link>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
