import { Check, Circle, Loader2, SkipForward, X } from 'lucide-react';
import clsx from 'clsx';
import type { NodeStatus } from '../../graph/mergeStatus';

const STATUS_CONFIG: Record<NodeStatus, { label: string; icon: typeof Circle; className: string }> = {
  IDLE: { label: 'Idle', icon: Circle, className: 'bg-slate-100 text-slate-500' },
  PENDING: { label: 'Pending', icon: Circle, className: 'bg-slate-100 text-slate-500' },
  RUNNING: { label: 'Running', icon: Loader2, className: 'bg-ulink-orange/15 text-ulink-orange-dark' },
  DONE: { label: 'Done', icon: Check, className: 'bg-ulink-teal/15 text-ulink-teal-dark' },
  FAILED: { label: 'Failed', icon: X, className: 'bg-red-100 text-red-600' },
  SKIPPED: { label: 'Skipped', icon: SkipForward, className: 'bg-slate-100 text-slate-400' },
};

export function StatusBadge({ status, className }: { status: NodeStatus; className?: string }) {
  const { label, icon: Icon, className: statusClassName } = STATUS_CONFIG[status];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        statusClassName,
        className
      )}
    >
      <Icon size={11} className={status === 'RUNNING' ? 'animate-spin' : undefined} />
      {label}
    </span>
  );
}
