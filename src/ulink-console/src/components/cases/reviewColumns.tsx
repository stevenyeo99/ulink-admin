import clsx from 'clsx';
import { CaseStatusPill } from './CaseStatusPill';
import type { Column } from '../common/DataTable';
import { relativeTime } from '../../lib/relativeTime';
import type { ReviewQueueItem } from '../../types/case';
import type { Source } from '../../types/pipeline';

const REASON_STYLE: Record<string, string> = {
  'System issue': 'bg-red-100 text-red-700',
  'Data mismatch': 'bg-ulink-orange/15 text-ulink-orange-dark',
  'Rule hold': 'bg-violet-100 text-violet-700',
  Unreadable: 'bg-amber-100 text-amber-800',
  'AI unsure': 'bg-sky-100 text-sky-800',
};

/** The Review Queue's columns (Review queue page; reusable wherever queued cases are listed). */
export function reviewColumns(source: Source): Column<ReviewQueueItem>[] {
  return [
    {
      key: 'reason',
      header: 'Why',
      render: (i) => (
        <span className={clsx('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', REASON_STYLE[i.reason] ?? 'bg-slate-100 text-slate-600')}>
          {i.reason}
        </span>
      ),
    },
    {
      key: 'check',
      header: 'What to check',
      className: 'max-w-md',
      render: (i) => (
        <>
          <span className="text-slate-800">{i.check}</span>
          {i.pointCount > 1 && <span className="block text-xs text-slate-500">{i.pointCount - 1} more point(s) on the case page</span>}
        </>
      ),
    },
    {
      key: 'claim',
      header: source === 'API' ? 'IAS claim' : 'Claim',
      render: (i) => (
        <>
          <span className="text-slate-800">{i.claimNo ?? (source === 'API' ? '—' : i.recognizedType ?? '—')}</span>
          {i.tpaCaseNumber && <span className="block whitespace-nowrap text-xs text-slate-500">{i.tpaCaseNumber}</span>}
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <CaseStatusPill status={i.currentStatus} /> },
    { key: 'waiting', header: 'Last change', render: (i) => <span className="text-slate-500">{relativeTime(i.updatedAt)}</span> },
  ];
}
