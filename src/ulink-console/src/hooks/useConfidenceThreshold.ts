import { useQuery } from '@tanstack/react-query';
import { getStpSettings } from '../api/stpSettingsApi';

// The AI confidence threshold on the STP settings page (default 70%): at or below it the AI counts as unsure.
export function useConfidenceThreshold(): number {
  const { data } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings, staleTime: 60_000 });
  return data?.switches.aiConfidenceThreshold ?? 0.7;
}
