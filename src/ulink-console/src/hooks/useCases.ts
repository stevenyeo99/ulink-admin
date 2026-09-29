import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getApprovals, getCaseOverview, getReviewQueue, listCases } from '../api/casesApi';
import type { CaseListQuery } from '../types/case';
import type { Source } from '../types/pipeline';

/**
 * Fetch-on-mount only, no auto-polling — deliberately, after this session's rate-limit
 * incident on the pipeline canvas's polling. A case's status doesn't change on its own
 * between cron ticks the way a running job does, so there's no "live" value to poll for
 * here. Keyed by the whole query, so the sidebar's needs-review count and the Cases table's
 * current page are cached separately; the previous page stays on screen while the next loads.
 */
export function useCases(query: CaseListQuery = {}) {
  return useQuery({
    queryKey: ['cases', query],
    queryFn: () => listCases(query),
    placeholderData: keepPreviousData,
  });
}

/** Dashboard numbers for the Overview page. */
export function useCaseOverview(source?: Source) {
  return useQuery({ queryKey: ['cases-overview', source ?? 'all'], queryFn: () => getCaseOverview(source) });
}

/** The Review Queue; without a source, both workflows (the sidebar count). */
export function useReviewQueue(source?: Source) {
  return useQuery({ queryKey: ['review-queue', source ?? 'all'], queryFn: () => getReviewQueue(source), staleTime: 30_000 });
}

/** Claims waiting for JD3 approval in IAS. */
export function useApprovals(source?: Source) {
  return useQuery({ queryKey: ['approvals', source ?? 'all'], queryFn: () => getApprovals(source) });
}
