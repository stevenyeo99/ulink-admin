import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { getStpSettings } from '../../api/stpSettingsApi';

// The AI confidence threshold on the STP settings page (default 70%): at or below it the AI counts as unsure.
function useConfidenceThreshold(): number {
  const { data } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings, staleTime: 60_000 });
  return data?.switches.aiConfidenceThreshold ?? 0.7;
}

/**
 * One look for an AI confidence everywhere it is shown (SYSTEM_4 E4-23): the number and a word, coloured — never
 * colour alone. Red "issue" when the result itself failed; amber "unsure" at or below the threshold; green "sure"
 * above it. The reason sits next to it (the line's own "why").
 */
export function ConfidenceBadge({ confidence, failed = false }: { confidence: number | string; failed?: boolean }) {
  const threshold = useConfidenceThreshold();
  const value = Number(confidence);
  const percent = Math.round(value * 100);
  const kind = failed ? 'issue' : value <= threshold ? 'unsure' : 'sure';
  return (
    <span
      title={`AI confidence ${percent}% — ${kind === 'issue' ? 'the check found an issue' : kind === 'unsure' ? `unsure (at or below ${Math.round(threshold * 100)}%)` : `above the ${Math.round(threshold * 100)}% threshold`}`}
      className={clsx('inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold', {
        'bg-red-50 text-red-700': kind === 'issue',
        'bg-amber-50 text-amber-700': kind === 'unsure',
        'bg-ulink-teal/10 text-ulink-teal-dark': kind === 'sure',
      })}
    >
      {percent}% · {kind}
    </span>
  );
}
