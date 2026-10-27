import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getApprovals, getCaseOverview, getReviewQueue, getReviewed, listCases } from '../api/casesApi';
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

/**
 * The Reviewed page and its sidebar count (SYSTEM_5 review lane). Polls every 5 seconds only while cases are being
 * checked again — they move within seconds or minutes — and not otherwise; a save invalidates it ('reviewed').
 */
export function useReviewed(source?: Source) {
  return useQuery({
    queryKey: ['reviewed', source ?? 'all'],
    queryFn: () => getReviewed(source),
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.total ? 5_000 : false),
  });
}

/** Claims waiting for JD3 approval in IAS. */
export function useApprovals(source?: Source) {
  return useQuery({ queryKey: ['approvals', source ?? 'all'], queryFn: () => getApprovals(source) });
}
