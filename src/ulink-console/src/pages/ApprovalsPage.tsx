import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApprovals } from '../hooks/useCases';
import { SourceTag } from '../components/common/SourceTag';
import { SourceTabs } from '../components/common/SourceTabs';
import { pickView, sourceOf, viewParam, useEnabledSources } from '../hooks/useSource';
import { DataTable, type Column } from '../components/common/DataTable';
import { WaitingCell } from '../components/common/WaitingCell';
import type { ApprovalItem } from '../types/case';
import { ClaimSearch } from '../components/common/ClaimSearch';
import { matchesClaim } from '../lib/claimSearch';

const PAGE_SIZE = 25;
const EMPTY: ApprovalItem[] = [];

/**
 * JD3's list (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md, step 6): non-STP claims
 * waiting for approval in IAS, oldest first, with what the AI flagged. The system can't see the
 * approval itself in IAS, so a claim stays here until something moves it on.
 */
export function ApprovalsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const source = pickView(params.get('source'), useEnabledSources());
  const page = Math.max(0, Number(params.get('page')) || 0);
  const { data, isLoading, isFetching, isError } = useApprovals(sourceOf(source));
  const q = params.get('q') ?? '';
  const items = (data?.items ?? EMPTY).filter((i) => matchesClaim(i, q));
  // A new search starts on the first page.
  const search = (text: string) => {
    const nextParams = new URLSearchParams(params);
    if (text) nextParams.set('q', text);
    else nextParams.delete('q');
    nextParams.delete('page');
    setParams(nextParams, { replace: true });
  };

  const columns: Column<ApprovalItem>[] = [
    {
      key: 'claim',
      header: source === 'API' ? 'IAS claim' : 'Claim',
      render: (i) => (
        <>
          {source === 'ALL' && <SourceTag source={i.source} />}
          <span className="text-slate-800">{i.claimNo ?? '—'}</span>
          {i.tpaCaseNumber && <span className="block whitespace-nowrap text-xs text-slate-500">{i.tpaCaseNumber}</span>}
          {i.claim && <span className="block text-xs text-ulink-teal-dark">Being reviewed by {i.claim.name}</span>}
        </>
      ),
    },
    {
      key: 'ai',
      header: 'Check before approving',
      className: 'max-w-lg',
      render: (i) =>
        i.reviewPoints.length === 0 ? (
          <span className="text-slate-500">The AI flagged nothing.</span>
        ) : (
          <ul className="space-y-0.5">
            {i.reviewPoints.map((point) => (
              <li key={point} className="text-slate-800">
                {point}
              </li>
            ))}
          </ul>
        ),
    },
    { key: 'waiting', header: 'Waiting since', render: (i) => <WaitingCell updatedAt={i.updatedAt} overdue={i.overdue} waitingWorkingDays={i.waitingWorkingDays} /> },
  ];

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4">
        <SourceTabs withAll source={source} onChange={(next) => setParams(viewParam(next) ? { source: viewParam(next) } : {}, { replace: true })} />
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Claims that passed every check and are in IAS, waiting for approval. Open one to see the full AI assessment, then approve
        it in IAS.
      </p>
      <div className="mb-3">
        <ClaimSearch value={q} onChange={search} />
      </div>
      <DataTable
        columns={columns}
        rows={items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={(i) => i.id}
        onRowClick={(i) => navigate(`/cases/${i.id}`)}
        page={page}
        pageSize={PAGE_SIZE}
        total={items.length}
        onPageChange={(next) => {
          const nextParams = new URLSearchParams(params);
          if (next > 0) nextParams.set('page', String(next));
          else nextParams.delete('page');
          setParams(nextParams, { replace: true });
        }}
        isLoading={isLoading || isFetching}
        isError={isError}
        emptyText={q ? `No claim here matches "${q}".` : 'No claims are waiting for approval.'}
      />
    </div>
  );
}
