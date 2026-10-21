import clsx from 'clsx';
import type { NextAction } from '../../types/case';

/**
 * "Next:" — what has to happen to this case now and who does it (ulink-api modules/assessment-summary/nextAction.js,
 * SYSTEM_4 E4-21). Orange when a person has to act. On the case page and at the top of the review workspace.
 */
export function NextActionBox({ next, className }: { next: NextAction; className?: string }) {
  return (
    <div
      className={clsx(
        'rounded-lg border-l-4 px-4 py-3 text-sm',
        next.act ? 'border-ulink-orange bg-ulink-orange/5 text-slate-800' : 'border-slate-300 bg-slate-50 text-slate-600',
        className
      )}
    >
      <span className="font-semibold">Next: </span>
      {next.text}
      {next.who && <span className="ml-2 whitespace-nowrap text-xs text-slate-500">({next.who})</span>}
    </div>
  );
}
