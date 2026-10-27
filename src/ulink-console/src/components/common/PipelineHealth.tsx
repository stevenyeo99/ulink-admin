import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getLatestRun } from '../../api/pipelineApi';
import { getStpSettings } from '../../api/stpSettingsApi';
import { useReviewed } from '../../hooks/useCases';
import { relativeTime } from '../../lib/relativeTime';
import type { Source } from '../../types/pipeline';


/**
 * One line on the Overview (SYSTEM_4 E4-19 / E6): the last pipeline run of this source and how it went — red when it
 * failed, ended with errors, is still running past the limit (stuck), or no run came within the limit (cron stopped).
 * The limits are System settings (default 3× the cron interval: email 30 min, API 90 min).
 */
export function PipelineHealth({ source }: { source: Source }) {
  const { data: run, isLoading, isError } = useQuery({ queryKey: ['pipeline-latest', source], queryFn: () => getLatestRun(source), refetchInterval: 60_000 });
  const { data: settings } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings, staleTime: 60_000 });
  // The same query as the sidebar count (one request), API cases only.
  const { data: reviewed } = useReviewed();
  const waitingApi = reviewed?.items.filter((i) => i.source === 'API').length ?? 0;
  if (isLoading || !settings) return null;
  // The API review lane (SYSTEM_5): decided cases waiting, no round running, and none started for 15 minutes — is the
  // retry cron running?
  const roundMinutes = reviewed?.lastRoundAt ? (Date.now() - new Date(reviewed.lastRoundAt).getTime()) / 60000 : Infinity;
  const laneProblem = source === 'API' && waitingApi > 0 && !reviewed?.lastRoundRunning && roundMinutes > 15
    ? `${waitingApi} decided case${waitingApi === 1 ? '' : 's'} waiting; last review round ${reviewed?.lastRoundAt ? relativeTime(reviewed.lastRoundAt) : 'never'}.`
    : null;
  const staleMinutes = source === 'API' ? settings.switches.pipelineStaleMinutesApi : settings.switches.pipelineStaleMinutesEmail;

  const minutes = run ? (Date.now() - new Date(run.startedAt).getTime()) / 60000 : Infinity;
  const problem = isError ? "Couldn't load the last pipeline run."
    : !run ? 'No pipeline run yet.'
      : run.status === 'FAILED' ? 'The last pipeline run failed.'
        : run.status === 'COMPLETED_WITH_ERRORS' ? 'The last pipeline run ended with errors.'
          : run.status === 'RUNNING' && minutes > staleMinutes ? `The run started ${Math.round(minutes)} minutes ago and hasn't finished — is it stuck?`
            : minutes > staleMinutes ? `No pipeline run for ${Math.round(minutes)} minutes — is the schedule (cron) running?`
              : null;

  return (
    <Link
      to={`/pipeline${source === 'API' ? '?source=api' : ''}`}
      className={clsx(
        'mb-4 flex flex-wrap items-center gap-x-2 rounded-lg px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
        problem || laneProblem ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
      )}
    >
      <span className="font-medium">{source === 'API' ? 'API' : 'Email'} pipeline:</span>
      {run && <span>last run {relativeTime(run.startedAt)} — {run.status.toLowerCase().replace(/_/g, ' ')}</span>}
      {problem && <span className="font-medium">{problem}</span>}
      {laneProblem && <span className="font-medium text-red-700">Review lane: {laneProblem}</span>}
    </Link>
  );
}
