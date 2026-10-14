import clsx from 'clsx';
import { useEnabledSources } from '../../hooks/useSource';
import type { Source } from '../../types/pipeline';

const TABS: { source: Source; label: string }[] = [
  { source: 'EMAIL', label: 'Email' },
  { source: 'API', label: 'API' },
];

// Only the sources switched on (SYSTEM_4 E4-01); with just one, no tab bar. showAll: every source regardless
// (STP settings — rules can be prepared for a source before it goes live).
export function SourceTabs({ source, onChange, showAll = false }: { source: Source; onChange: (source: Source) => void; showAll?: boolean }) {
  const enabled = useEnabledSources();
  const tabs = showAll ? TABS : TABS.filter((tab) => enabled.includes(tab.source));
  if (tabs.length < 2) return null;
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
