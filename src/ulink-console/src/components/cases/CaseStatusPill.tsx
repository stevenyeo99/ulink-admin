import clsx from 'clsx';
import { bucketOf, humanizeStatus, type StatusBucket } from '../../lib/caseStatusBuckets';

const BUCKET_COLORS: Record<StatusBucket, string> = {
  'Needs Review': 'bg-ulink-orange/15 text-ulink-orange-dark',
  'In Progress': 'bg-slate-100 text-slate-500',
  Succeeded: 'bg-ulink-teal/15 text-ulink-teal-dark',
  Failed: 'bg-red-100 text-red-600',
};

export function CaseStatusPill({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        BUCKET_COLORS[bucketOf(status)]
      )}
    >
      {humanizeStatus(status)}
    </span>
  );
}
