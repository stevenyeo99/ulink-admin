import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCaseStatuses } from '../api/casesApi';
import type { CaseStatusInfo } from '../types/case';

/** The status catalog — fixed for the life of the page, so fetched once. */
export function useCaseStatuses() {
  const query = useQuery({ queryKey: ['case-statuses'], queryFn: getCaseStatuses, staleTime: Infinity });
  // An unknown code (catalog not loaded yet, or a brand-new status) still reads as words.
  const statuses = query.data?.statuses;
  const info = useCallback(
    (code: string): CaseStatusInfo =>
      statuses?.[code] ?? {
        module: 'other',
        group: 'in_progress',
        label: code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
        description: code,
      },
    [statuses]
  );
  return { ...query, info };
}
