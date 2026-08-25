import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useCases } from '../hooks/useCases';
import { CaseStatusPill } from '../components/cases/CaseStatusPill';
import { Button } from '../components/common/Button';
import { relativeTime } from '../lib/relativeTime';
import { bucketOf, STATUS_BUCKET_FILTERS } from '../lib/caseStatusBuckets';
import type { CaseSummary } from '../types/case';

const EMPTY_CASES: CaseSummary[] = [];

export function CasesPage() {
  const { data, isLoading, isFetching, isError, refetch } = useCases();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof STATUS_BUCKET_FILTERS)[number]>('All');
  const allCases = data?.cases ?? EMPTY_CASES;

  const cases = useMemo(
    () => (filter === 'All' ? allCases : allCases.filter((c) => bucketOf(c.currentStatus) === filter)),
    [allCases, filter]
  );

  return (
    <div className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Cases</h1>
          <p className="text-sm text-slate-500">Every case the system has processed — its extraction, checks, and outcome.</p>
        </div>
        <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-1 rounded-full bg-slate-100/80 p-1 w-fit">
        {STATUS_BUCKET_FILTERS.map((bucket) => (
          <button
            key={bucket}
            onClick={() => setFilter(bucket)}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === bucket ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            {bucket}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl2 border border-slate-900/5 bg-white/80 shadow-glass backdrop-blur-xl">
        {isLoading && <p className="p-6 text-sm text-slate-400">Loading…</p>}
        {isError && <p className="p-6 text-sm text-red-500">Couldn't load cases. Try refreshing.</p>}
        {!isLoading && !isError && cases.length === 0 && (
          <p className="p-6 text-sm text-slate-400">
            {allCases.length === 0 ? 'No cases yet.' : `No cases in "${filter}".`}
          </p>
        )}
        {cases.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-900/5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Summary</th>
                <th className="px-5 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/cases/${c.id}`)}
                  className="cursor-pointer border-b border-slate-900/5 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-5 py-3">
                    <CaseStatusPill status={c.currentStatus} />
                  </td>
                  <td className="px-5 py-3 text-slate-700">{c.recognizedType ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-500">{c.summary ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-400">{relativeTime(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
