import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLatestRun, getRun, RateLimitedError, runPipeline } from '../api/pipelineApi';
import type { PipelineRun } from '../types/pipeline';

const TERMINAL_STATUSES: PipelineRun['status'][] = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'];

// ulink-api's rate limiter (app.js) is a shared, global 100-requests/15-minutes budget —
// across this console, cron-triggered job calls, and any other client hitting the same API
// (confirmed live: this console alone at a naive 1-4s poll tripped it during testing). These
// numbers are deliberately conservative relative to that ceiling, not just "responsive
// enough": 20s idle x 45 req/15min, plus the detail poll only running (paused entirely while
// idle, see latestRunQuery below) for the actual duration of a run. A pipeline run here
// realistically runs for minutes, not seconds (LLM/IAS calls), so a few seconds of latency
// noticing a status change is invisible to a human watching the canvas.
const LATEST_RUN_POLL_MS = 20000;
const ACTIVE_RUN_POLL_MS = 3000;

/**
 * Owns the full lifecycle of "the pipeline run currently shown on the canvas". Two layers:
 *  - latestRunQuery: a cheap poll of GET /runs?limit=1, purely to detect that a newer run
 *    now exists (whoever/whatever started it — see LATEST_RUN_POLL_MS above). Paused
 *    entirely whenever a non-terminal run is already being tracked (no benefit to it right
 *    then — the tighter runQuery below already covers that case, and two pipeline runs can
 *    never genuinely overlap thanks to the 'pipeline' job lock).
 *  - runQuery: the detailed GET /runs/:id (with steps) for whichever run id is currently
 *    tracked, polled while that run is non-terminal.
 * mergeStatus.ts is what actually turns `steps` into graph node/edge state; this hook only
 * owns fetching it.
 */
export function usePipelineRun() {
  const queryClient = useQueryClient();
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  const [trackedStartedAt, setTrackedStartedAt] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey: ['pipeline-run', trackedRunId],
    queryFn: () => getRun(trackedRunId as string),
    enabled: trackedRunId !== null,
    refetchInterval: (query) => {
      if (query.state.error instanceof RateLimitedError) return query.state.error.retryAfterMs;
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.includes(status)) return false;
      return ACTIVE_RUN_POLL_MS;
    },
  });

  const isTrackingActiveRun = runQuery.data ? !TERMINAL_STATUSES.includes(runQuery.data.status) : trackedRunId !== null && !runQuery.isError;

  const latestRunQuery = useQuery({
    queryKey: ['latest-pipeline-run'],
    queryFn: getLatestRun,
    refetchInterval: (query) => {
      if (query.state.error instanceof RateLimitedError) return query.state.error.retryAfterMs;
      if (isTrackingActiveRun) return false;
      return LATEST_RUN_POLL_MS;
    },
  });

  // Adopt the latest run whenever it's actually newer than whatever we're currently
  // tracking — comparing startedAt (not just "different id") so a stale/racing response
  // can never regress the view back to an older run, including right after this console's
  // own trigger() call already set trackedRunId optimistically.
  useEffect(() => {
    const latest = latestRunQuery.data;
    if (!latest) return;
    if (!trackedStartedAt || new Date(latest.startedAt) > new Date(trackedStartedAt)) {
      setTrackedRunId(latest.id);
      setTrackedStartedAt(latest.startedAt);
    }
  }, [latestRunQuery.data, trackedStartedAt]);

  const triggerMutation = useMutation({
    mutationFn: runPipeline,
    onSuccess: (response) => {
      if (response.skipped || !response.runId) return;
      setTrackedRunId(response.runId);
      setTrackedStartedAt(new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ['pipeline-run', response.runId] });
    },
  });

  const trigger = useCallback(() => triggerMutation.mutate(), [triggerMutation]);

  const run = runQuery.data ?? null;
  const isRunning = run?.status === 'RUNNING' || triggerMutation.isPending;
  const wasSkipped = triggerMutation.data?.skipped === true;
  const isRateLimited = runQuery.error instanceof RateLimitedError || latestRunQuery.error instanceof RateLimitedError;

  return {
    run,
    steps: run?.PipelineRunSteps ?? [],
    isRunning,
    isLoading: runQuery.isLoading && trackedRunId !== null,
    wasSkipped,
    isRateLimited,
    trigger,
  };
}
