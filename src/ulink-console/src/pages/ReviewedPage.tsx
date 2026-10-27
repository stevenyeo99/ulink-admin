import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import { useReviewed } from '../hooks/useCases';
import { runReviewed } from '../api/casesApi';
import { SourceTabs } from '../components/common/SourceTabs';
import { SourceTag } from '../components/common/SourceTag';
import { DataTable, type Column } from '../components/common/DataTable';
import { Button } from '../components/common/Button';
import { pickView, sourceOf, viewParam, useEnabledSources } from '../hooks/useSource';
import { isSuperAdmin } from '../lib/session';
import type { ReviewedItem } from '../types/case';

const PAGE_SIZE = 25;
const MAX_RUN = 20;
const EMPTY: ReviewedItem[] = [];

const ROUND: Record<ReviewedItem['lastRound']['state'], string> = { running: 'Running', waiting: 'Waiting for the next round', failed: 'Failed' };

/**
 * Cases a person decided that the review lane is checking again (SYSTEM_5, docs/imp/CR/SYSTEM_5/PRD/REVIEW_LANE_PRD.md
 * 4.6). They are not in the Review queue meanwhile. A case leaves this list by itself at its next stop, wait or end;
 * a row waiting too long is highlighted. Super admins can run the review lane now for one case or a selection.
 */
export function ReviewedPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const source = pickView(params.get('source'), useEnabledSources());
  const { data, isLoading, isError } = useReviewed(sourceOf(source));
  // Cases leave the list by themselves: a page past the end shows the last one.
  const lastPage = Math.max(0, Math.ceil((data?.items.length ?? 0) / PAGE_SIZE) - 1);
  const page = Math.min(Math.max(0, Number(params.get('page')) || 0), lastPage);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const canRun = isSuperAdmin();

  const items = data?.items ?? EMPTY;
  // Both flows have a review lane (API and email): every listed case can run here.
  const runnable = (_: ReviewedItem) => canRun;
  const chosen = items.filter((i) => selected.has(i.id) && runnable(i)).map((i) => i.id);

  const run = useMutation({
    mutationFn: (ids: string[]) => runReviewed(ids),
    onSuccess: (result, ids) => {
      setSelected(new Set());
      setMessage(result.queued
        ? `A review round is busy. ${ids.length === 1 ? 'This case runs' : 'These cases run'} first in the next round.`
        : result.skipped ? 'API cases are switched off in System settings: nothing ran.' : `Running ${ids.length} case${ids.length === 1 ? '' : 's'} now.`);
      queryClient.invalidateQueries({ queryKey: ['reviewed'] });
    },
  });

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const columns: Column<ReviewedItem>[] = [
    ...(canRun ? [{
      key: 'select',
      header: '',
      className: 'w-8',
      render: (i: ReviewedItem) => (runnable(i) ? (
        <input
          type="checkbox"
          aria-label={`Select ${i.claimNo ?? i.tpaCaseNumber ?? i.id}`}
          checked={selected.has(i.id)}
          disabled={!selected.has(i.id) && chosen.length >= MAX_RUN}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(i.id)}
        />
      ) : null),
    }] : []),
    {
      key: 'case',
      header: 'Case',
      render: (i) => (
        <div className="flex items-center gap-2">
          {source === 'ALL' && <SourceTag source={i.source} />}
          <div>
            <span className="font-medium text-slate-800">{i.claimNo ?? i.tpaCaseNumber ?? '—'}</span>
            {i.claimant && <p className="text-xs text-slate-500">{i.claimant}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'decision',
      header: 'Decision',
      render: (i) => (
        <div className="max-w-md text-sm text-slate-700">
          <p className="line-clamp-2">{i.decision ?? 'Decided'}</p>
          <p className="text-xs text-slate-500">{i.decidedBy ?? 'Someone'}, {new Date(i.decidedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      ),
    },
    { key: 'now', header: 'Now', render: (i) => <span className="text-sm text-slate-700">{i.statusLabel}</span> },
    {
      key: 'waiting',
      header: 'Waiting',
      render: (i) => <span className={clsx('text-sm tabular-nums', i.highlighted ? 'font-semibold text-red-700' : 'text-slate-600')}>{i.waitingMinutes < 1 ? 'under 1 min' : `${i.waitingMinutes} min`}</span>,
    },
    {
      key: 'round',
      header: 'Last round',
      render: (i) => (
        <div className="text-sm">
          <span className={i.lastRound.state === 'failed' ? 'font-semibold text-red-700' : 'text-slate-600'}>{ROUND[i.lastRound.state]}</span>
          {i.lastRound.state === 'failed' && i.lastRound.error && <p className="max-w-xs truncate text-xs text-red-700" title={i.lastRound.error}>{i.lastRound.error}</p>}
        </div>
      ),
    },
    ...(canRun ? [{
      key: 'run',
      header: '',
      render: (i: ReviewedItem) => (runnable(i) ? (
        <Button size="sm" variant="ghost" disabled={run.isPending} aria-label={`Run now: ${i.claimNo ?? i.tpaCaseNumber ?? i.id}`} onClick={(e) => { e.stopPropagation(); run.mutate([i.id]); }} className="shadow-none">
          <Play size={14} /> Run now
        </Button>
      ) : null),
    }] : []),
  ];

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-4">
        <SourceTabs withAll source={source} onChange={(next) => setParams(viewParam(next) ? { source: viewParam(next) as string } : {}, { replace: true })} />
      </div>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Cases a person decided. The system is checking them again and moves them on: to the next step, back to the Review
        queue if it finds something new, or to the customer. A case waiting more than {data?.highlightMinutes ?? 15} minutes is shown in red.
      </p>
      {message && <p role="status" className="mb-3 rounded-lg bg-ulink-teal/5 px-3 py-2 text-sm text-slate-800">{message}</p>}
      {run.isError && <p className="mb-3 text-sm text-red-600">{(run.error as Error).message}</p>}
      {canRun && chosen.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(chosen)}><Play size={14} /> Run selected ({chosen.length})</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="shadow-none">Clear</Button>
          {chosen.length >= MAX_RUN && <span className="text-xs text-slate-500">At most {MAX_RUN} at once.</span>}
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
        onPageChange={(next) => setParams((p) => { const n = new URLSearchParams(p); if (next > 0) n.set('page', String(next)); else n.delete('page'); return n; }, { replace: true })}
        isLoading={isLoading}
        isError={isError}
        emptyText="No case is being checked again. A case appears here after a person decides it on the review page."
      />
    </div>
  );
}
