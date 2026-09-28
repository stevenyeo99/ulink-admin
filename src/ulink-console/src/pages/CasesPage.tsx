import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { useCases } from '../hooks/useCases';
import { useCaseStatuses } from '../hooks/useCaseStatuses';
import { caseColumns } from '../components/cases/caseColumns';
import { Button } from '../components/common/Button';
import { SourceTabs } from '../components/common/SourceTabs';
import { DataTable, type SortState } from '../components/common/DataTable';
import type { CaseListQuery, CaseSummary } from '../types/case';
import type { Source } from '../types/pipeline';

const PAGE_SIZE = 25;
const EMPTY: CaseSummary[] = [];

/**
 * Every case, searchable and filterable. The whole view lives in the URL
 * (?source=api&group=needs_review&module=member&q=…&sort=…&dir=…&page=…), so Overview and other
 * pages can link straight into a filtered list, and a reload or shared link keeps it.
 */
export function CasesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: catalog, info } = useCaseStatuses();

  const source: Source = params.get('source')?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  const group = params.get('group') ?? '';
  const moduleId = params.get('module') ?? '';
  const q = params.get('q') ?? '';
  const sort: SortState = {
    key: params.get('sort') ?? 'updatedAt',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
  };
  const page = Math.max(0, Number(params.get('page')) || 0);

  // Changing any filter goes back to the first page; empty values leave the URL.
  const update = (patch: Record<string, string>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // Search box: type freely, the list follows a moment after typing stops.
  const [searchText, setSearchText] = useState(q);
  useEffect(() => setSearchText(q), [q]);
  useEffect(() => {
    if (searchText.trim() === q) return undefined;
    const timer = setTimeout(() => update({ q: searchText.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text should restart the timer
  }, [searchText]);

  const query: CaseListQuery = {
    source,
    group: group || undefined,
    module: moduleId || undefined,
    q: q || undefined,
    sort: sort.key as CaseListQuery['sort'],
    dir: sort.dir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const { data, isLoading, isFetching, isError, refetch } = useCases(query);
  const rows = data?.cases ?? EMPTY;
  const moduleLabel = (id: string) => catalog?.modules.find((m) => m.id === id)?.label ?? '—';

  const columns = caseColumns(source, (status) => moduleLabel(info(status).module));

  const filtered = Boolean(group || moduleId || q);

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SourceTabs source={source} onChange={(next) => update({ source: next === 'API' ? 'api' : '' })} />
        <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[16rem] flex-1">
          <span className="sr-only">Search cases</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search claim no., TPA case no., claimant or case ID"
            className="w-full rounded-full border border-slate-900/10 bg-white/80 py-2 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-ulink-teal focus:outline-none focus:ring-2 focus:ring-ulink-teal/30"
          />
        </label>
        <label>
          <span className="sr-only">Step</span>
          <select
            value={moduleId}
            onChange={(e) => update({ module: e.target.value })}
            className="rounded-full border border-slate-900/10 bg-white/80 py-2 pl-4 pr-8 text-sm text-slate-700 focus:border-ulink-teal focus:outline-none focus:ring-2 focus:ring-ulink-teal/30"
          >
            <option value="">All steps</option>
            {catalog?.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-full bg-slate-100/80 p-1">
        {[{ id: '', label: 'All' }, ...(catalog?.groups ?? [])].map((g) => (
          <button
            key={g.id || 'all'}
            onClick={() => update({ group: g.id })}
            aria-pressed={group === g.id}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
              group === g.id ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/cases/${c.id}`)}
        sort={sort}
        onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.total ?? 0}
        onPageChange={(next) => update({ page: next > 0 ? String(next) : '' }, true)}
        isLoading={isLoading || isFetching}
        isError={isError}
        emptyText={filtered ? 'No cases match these filters. Clear the search or pick "All".' : 'No cases yet. New claims appear here once the pipeline takes them in.'}
      />
    </div>
  );
}
