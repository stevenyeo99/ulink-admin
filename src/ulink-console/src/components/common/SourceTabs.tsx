import clsx from 'clsx';
import type { Source } from '../../types/pipeline';

const TABS: { source: Source; label: string }[] = [
  { source: 'EMAIL', label: 'Email' },
  { source: 'API', label: 'API' },
];

export function SourceTabs({ source, onChange }: { source: Source; onChange: (source: Source) => void }) {
  return (
    <div role="tablist" aria-label="Workflow" className="flex w-fit items-center gap-1 rounded-full bg-slate-100/80 p-1">
      {TABS.map((tab) => (
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
