import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApprovals } from '../hooks/useCases';
import { SourceTabs } from '../components/common/SourceTabs';
import { DataTable, type Column } from '../components/common/DataTable';
import { relativeTime } from '../lib/relativeTime';
import type { ApprovalItem } from '../types/case';
import type { Source } from '../types/pipeline';

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
  const source: Source = params.get('source')?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const { data, isLoading, isFetching, isError } = useApprovals(source);
  const items = data?.items ?? EMPTY;

  const columns: Column<ApprovalItem>[] = [
    {
      key: 'claim',
      header: source === 'API' ? 'IAS claim' : 'Claim',
      render: (i) => (
        <>
          <span className="text-slate-800">{i.claimNo ?? '—'}</span>
          {i.tpaCaseNumber && <span className="block whitespace-nowrap text-xs text-slate-500">{i.tpaCaseNumber}</span>}
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
    { key: 'waiting', header: 'Waiting since', render: (i) => <span className="whitespace-nowrap text-slate-500">{relativeTime(i.updatedAt)}</span> },
  ];

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4">
        <SourceTabs source={source} onChange={(next) => setParams(next === 'API' ? { source: 'api' } : {}, { replace: true })} />
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Claims that passed every check and are in IAS, waiting for approval. Open one to see the full AI assessment, then approve
        it in IAS.
      </p>
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
        emptyText="No claims are waiting for approval."
      />
    </div>
  );
}
