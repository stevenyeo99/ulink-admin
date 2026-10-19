import clsx from 'clsx';
import { useEnabledSources, type SourceView } from '../../hooks/useSource';

const TABS: { source: SourceView; label: string }[] = [
  { source: 'EMAIL', label: 'Email' },
  { source: 'API', label: 'API' },
];

// Only the sources switched on (SYSTEM_4 E4-01); with just one, no tab bar. showAll: every source regardless
// (STP settings — rules can be prepared for a source before it goes live). withAll: an "All" tab first, both flows
// together (the work lists).
export function SourceTabs<V extends SourceView>({ source, onChange, showAll = false, withAll = false }: { source: V; onChange: (source: V) => void; showAll?: boolean; withAll?: boolean }) {
  const enabled = useEnabledSources();
  const flows = showAll ? TABS : TABS.filter((tab) => tab.source !== 'ALL' && enabled.includes(tab.source));
  if (flows.length < 2) return null;
  const tabs = (withAll ? [{ source: 'ALL' as SourceView, label: 'All' }, ...flows] : flows) as { source: V; label: string }[];
  return (
    <div role="tablist" aria-label="Workflow" className="flex w-fit items-center gap-1 rounded-full bg-slate-100/80 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.source}
          role="tab"
          aria-selected={source === tab.source}
          onClick={() => onChange(tab.source)}
          className={clsx(
            'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            source === tab.source ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
