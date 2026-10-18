import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getStpSettings } from '../api/stpSettingsApi';
import type { Source } from '../types/pipeline';

const ALL_SOURCES: Source[] = ['EMAIL', 'API'];

/**
 * The sources switched on (System settings page, SYSTEM_4 E4-01). Both while loading, or when both are off — hiding a
 * tab is a convenience; the API itself refuses to run a switched-off pipeline.
 */
export function useEnabledSources(): Source[] {
  const { data } = useQuery({ queryKey: ['stp-settings'], queryFn: getStpSettings, staleTime: 60_000 });
  if (!data) return ALL_SOURCES;
  const on = ALL_SOURCES.filter((s) => (s === 'EMAIL' ? data.switches.emailCasesEnabled : data.switches.apiCasesEnabled));
  return on.length ? on : ALL_SOURCES;
}

// The source a page shows: the one in the URL (?source=api) when it is switched on, else the first one that is.
export function pickSource(param: string | null, enabled: Source[]): Source {
  const asked: Source = param?.toUpperCase() === 'API' ? 'API' : 'EMAIL';
  return enabled.includes(asked) ? asked : enabled[0];
}

/**
 * Which workflow a page shows, kept in the URL (?source=api) so a link or reload keeps the tab.
 * Email is the default while email cases are switched on — otherwise the first source that is.
 */
export function useSource(): [Source, (source: Source) => void] {
  const [params, setParams] = useSearchParams();
  const source = pickSource(params.get('source'), useEnabledSources());
  const setSource = (next: Source) => setParams(next === 'EMAIL' ? {} : { source: 'api' }, { replace: true });
  return [source, setSource];
}
