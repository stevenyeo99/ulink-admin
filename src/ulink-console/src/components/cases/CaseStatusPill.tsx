import clsx from 'clsx';
import { useCaseStatuses } from '../../hooks/useCaseStatuses';
import type { StatusGroup } from '../../types/case';

const GROUP_COLORS: Record<StatusGroup, string> = {
  in_progress: 'bg-slate-100 text-slate-600',
  waiting_customer: 'bg-amber-100 text-amber-800',
  needs_review: 'bg-ulink-orange/15 text-ulink-orange-dark',
  done: 'bg-ulink-teal/15 text-ulink-teal-dark',
  failed: 'bg-red-100 text-red-700',
};

/** A case's status in words (label), with what it means and its internal code on hover. */
export function CaseStatusPill({ status }: { status: string }) {
  const { info } = useCaseStatuses();
  const { label, description, group } = info(status);
  return (
    <span
      title={`${description} (${status})`}
      className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', GROUP_COLORS[group])}
    >
      {label}
    </span>
  );
}
