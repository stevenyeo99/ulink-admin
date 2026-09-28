import { CaseStatusPill } from './CaseStatusPill';
import type { Column } from '../common/DataTable';
import { relativeTime } from '../../lib/relativeTime';
import type { CaseSummary } from '../../types/case';
import type { Source } from '../../types/pipeline';

/** The case list's columns (Cases page; reusable by later lists such as Approvals). */
export function caseColumns(source: Source, stepLabel: (status: string) => string): Column<CaseSummary>[] {
  return [
    { key: 'status', header: 'Status', sortKey: 'status', render: (c) => <CaseStatusPill status={c.currentStatus} /> },
    {
      key: 'claim',
      header: source === 'API' ? 'IAS claim' : 'Claim',
      sortKey: 'claimNo',
      render: (c) => (
        <>
          <span className="text-slate-800">{c.claimNo ?? (source === 'API' ? '—' : c.recognizedType ?? '—')}</span>
          {c.tpaCaseNumber && <span className="block whitespace-nowrap text-xs text-slate-500">{c.tpaCaseNumber}</span>}
        </>
      ),
    },
    { key: 'module', header: 'Step', render: (c) => <span className="text-slate-600">{stepLabel(c.currentStatus)}</span> },
    { key: 'summary', header: 'Detail', className: 'max-w-xs', render: (c) => <span className="text-slate-500">{c.summary ?? '—'}</span> },
    { key: 'created', header: 'Received', sortKey: 'createdAt', render: (c) => <span className="text-slate-500">{relativeTime(c.createdAt)}</span> },
    { key: 'updated', header: 'Updated', sortKey: 'updatedAt', render: (c) => <span className="text-slate-500">{relativeTime(c.updatedAt)}</span> },
  ];
}
