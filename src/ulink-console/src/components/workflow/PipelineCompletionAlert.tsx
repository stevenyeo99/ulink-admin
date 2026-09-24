import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { PipelineRun, RunStatus } from '../../types/pipeline';

type TerminalStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

function isTerminal(status: RunStatus | null): status is TerminalStatus {
  return status === 'COMPLETED' || status === 'COMPLETED_WITH_ERRORS' || status === 'FAILED';
}

const AUTO_DISMISS_MS = 8000;

// Per-viewer convenience only (which run this browser has already been told about) — never
// read back by the backend, so a plain try/catch around it is enough; a private window or
// blocked storage just means "always treat as unacknowledged", never a crash.
const ALERTED_RUN_STORAGE_KEY = 'ulink-console:pipeline-alerted-run-id';

function getAlertedRunId(): string | null {
  try {
    return window.localStorage.getItem(ALERTED_RUN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setAlertedRunId(id: string): void {
  try {
    window.localStorage.setItem(ALERTED_RUN_STORAGE_KEY, id);
  } catch {
    // best-effort only
  }
}

const STYLE: Record<TerminalStatus, { Icon: typeof CheckCircle2; classes: string; label: string }> = {
  COMPLETED: { Icon: CheckCircle2, classes: 'border-ulink-teal/30 bg-ulink-teal/10 text-ulink-teal-dark', label: 'Pipeline run completed' },
  COMPLETED_WITH_ERRORS: {
    Icon: AlertTriangle,
    classes: 'border-ulink-orange/30 bg-ulink-orange/10 text-ulink-orange-dark',
    label: 'Pipeline run completed with errors',
  },
  FAILED: { Icon: XCircle, classes: 'border-red-300 bg-red-50 text-red-600', label: 'Pipeline run failed' },
};

/**
 * Fires a dismissible corner toast for a pipeline run reaching a terminal status
 * (COMPLETED/COMPLETED_WITH_ERRORS/FAILED) that this browser hasn't been told about yet.
 *
 * Deliberately keyed by run id in localStorage rather than "did I watch it transition while
 * mounted" (an earlier version did this with an in-memory ref) — that version missed the
 * common case of triggering a run, navigating to /cases or a case detail page while it runs
 * (minutes, for real LLM/IAS calls), and coming back after it already finished: the
 * component remounts fresh, sees the run already terminal, and an in-memory-only check has
 * no way to tell "just missed it" from "already acknowledged this one". Tracking the last
 * alerted run id instead means either path — watching it live or returning after the fact —
 * shows the toast exactly once per run.
 */
export function PipelineCompletionAlert({ run }: { run: PipelineRun | null }) {
  const [visibleStatus, setVisibleStatus] = useState<TerminalStatus | null>(null);

  useEffect(() => {
    if (!run || !isTerminal(run.status)) return;
    if (getAlertedRunId() === run.id) return;

    setVisibleStatus(run.status);
    setAlertedRunId(run.id);
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!visibleStatus) return undefined;
    const timer = setTimeout(() => setVisibleStatus(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visibleStatus]);

  if (!visibleStatus) return null;
  const { Icon, classes, label } = STYLE[visibleStatus];

  return (
    <div
      role="status"
      className={clsx(
        'fixed right-6 z-50 flex items-center gap-2 rounded-xl2 border px-4 py-3 text-sm font-medium shadow-glass backdrop-blur-xl',
        classes
      )}
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
    >
      <Icon size={16} className="shrink-0" />
      <span>{label}</span>
      <button onClick={() => setVisibleStatus(null)} className="ml-2 text-xs text-slate-400 hover:text-slate-600">
        Dismiss
      </button>
    </div>
  );
}
