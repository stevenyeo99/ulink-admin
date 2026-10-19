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

// The work lists (Cases, Review queue, Approvals) also show both flows together (owner, 2026-10-19 — DRT demo item 7):
// ALL, their default while both flows are switched on. ?source=email / ?source=api pick one; with only one flow on,
// that one.
export type SourceView = Source | 'ALL';

export function pickView(param: string | null, enabled: Source[]): SourceView {
  if (enabled.length < 2) return enabled[0];
  const asked = param?.toUpperCase();
  return asked === 'API' || asked === 'EMAIL' ? asked : 'ALL';
}

// The URL value of a work-list tab ('' = ALL, the default) and the source to ask the API for (undefined = both).
export const viewParam = (view: SourceView) => (view === 'ALL' ? '' : view.toLowerCase());
export const sourceOf = (view: SourceView): Source | undefined => (view === 'ALL' ? undefined : view);

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
