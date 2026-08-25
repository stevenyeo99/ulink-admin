import { Play } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../common/Button';
import { relativeTime } from '../../lib/relativeTime';
import type { PipelineRun } from '../../types/pipeline';

const RUN_STATUS_LABEL: Record<PipelineRun['status'], string> = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  COMPLETED_WITH_ERRORS: 'Completed with errors',
  FAILED: 'Failed',
};

interface PipelineToolbarProps {
  run: PipelineRun | null;
  isRunning: boolean;
  wasSkipped: boolean;
  isRateLimited: boolean;
  onRun: () => void;
}

export function PipelineToolbar({ run, isRunning, wasSkipped, isRateLimited, onRun }: PipelineToolbarProps) {
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-3">
      {run && (
        <div className="hidden items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-xs text-slate-500 shadow-glass sm:flex">
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', {
              'bg-ulink-orange animate-pulse': run.status === 'RUNNING',
              'bg-ulink-teal': run.status === 'COMPLETED',
              'bg-amber-500': run.status === 'COMPLETED_WITH_ERRORS',
              'bg-red-500': run.status === 'FAILED',
            })}
          />
          Last run {run.finishedAt ? relativeTime(run.finishedAt) : relativeTime(run.startedAt)} ·{' '}
          <span className="font-medium text-slate-700">{RUN_STATUS_LABEL[run.status]}</span>
        </div>
      )}
      {wasSkipped && <span className="text-xs font-medium text-ulink-orange-dark">A run is already in progress</span>}
      {isRateLimited && (
        <span className="text-xs font-medium text-red-500" title="ulink-api's rate limit was hit — this console is backing off automatically">
          API rate limited — retrying shortly
        </span>
      )}
      <Button onClick={onRun} disabled={isRunning}>
        <Play size={14} fill="currentColor" />
        {isRunning ? 'Running…' : 'Run Automation'}
      </Button>
    </div>
  );
}
