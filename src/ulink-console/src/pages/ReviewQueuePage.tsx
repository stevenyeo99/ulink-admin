import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useReviewQueue } from '../hooks/useCases';
import { reviewColumns } from '../components/cases/reviewColumns';
import { SourceTabs } from '../components/common/SourceTabs';
import { DataTable } from '../components/common/DataTable';
import type { ReviewQueueItem } from '../types/case';
import type { Source } from '../types/pipeline';

const PAGE_SIZE = 25;
const EMPTY: ReviewQueueItem[] = [];

/**
 * Cases a person should look at, oldest first (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md,
 * step 3). Each shows its most serious reason and what to check first; the case page has the full AI
 * assessment. Which cases qualify is decided in ulink-api modules/review-queue/queue.js.
 */
export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const source: Source = params.get('source')?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  const reason = params.get('reason') ?? '';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const { data, isLoading, isFetching, isError } = useReviewQueue(source);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const all = data?.items ?? EMPTY;
  const items = reason ? all.filter((i) => i.reason === reason) : all;
  const reasons = Object.entries(data?.counts ?? {}).filter(([, n]) => n > 0);

  const columns = reviewColumns(source);

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4">
        <SourceTabs source={source} onChange={(next) => update({ source: next === 'API' ? 'api' : '', reason: '' })} />
      </div>

      {reasons.length > 0 && (
        <div className="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-full bg-slate-100/80 p-1">
          {[['', all.length] as const, ...reasons].map(([r, n]) => (
            <button
              key={r || 'all'}
              onClick={() => update({ reason: r })}
              aria-pressed={reason === r}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
                reason === r ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              {r || 'All'} <span className="tabular-nums text-slate-400">{n}</span>
            </button>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={(i) => i.id}
        onRowClick={(i) => navigate(`/cases/${i.id}`)}
        page={page}
        pageSize={PAGE_SIZE}
        total={items.length}
        onPageChange={(next) => update({ page: next > 0 ? String(next) : '' })}
        isLoading={isLoading || isFetching}
        isError={isError}
        emptyText="Nothing to review. Cases appear here when a person needs to check the AI's work or fix an IAS rejection."
      />
    </div>
  );
}
