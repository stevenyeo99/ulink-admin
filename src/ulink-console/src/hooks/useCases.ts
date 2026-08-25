import { useQuery } from '@tanstack/react-query';
import { listCases } from '../api/casesApi';

/**
 * Fetch-on-mount only, no auto-polling — deliberately, after this session's rate-limit
 * incident on the pipeline canvas's polling. A case's status doesn't change on its own
 * between cron ticks the way a running job does, so there's no "live" value to poll for
 * here. Keyed by `status` so AppNav's Needs-Review badge query (a filtered subset) and
 * CasesPage's own unfiltered "all cases" query are cached separately, not conflated —
 * CasesPage's own Refresh button calls refetch() to update just its own query.
 */
export function useCases(status?: string) {
  return useQuery({
    queryKey: ['cases', status ?? 'all'],
    queryFn: () => listCases(status),
  });
}
