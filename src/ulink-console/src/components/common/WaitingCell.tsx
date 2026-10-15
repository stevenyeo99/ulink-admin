import { relativeTime } from '../../lib/relativeTime';

/**
 * How long a queued case has waited (SYSTEM_4 E4-19 / E6): the last change, and — past the STP-settings limit of working
 * days — a red "Overdue" so nothing sits unnoticed. Review queue and approvals.
 */
export function WaitingCell({ updatedAt, overdue, waitingWorkingDays }: { updatedAt: string; overdue?: boolean; waitingWorkingDays?: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-slate-500">{relativeTime(updatedAt)}</span>
      {overdue && (
        <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
          Overdue · {waitingWorkingDays} working day{waitingWorkingDays === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
