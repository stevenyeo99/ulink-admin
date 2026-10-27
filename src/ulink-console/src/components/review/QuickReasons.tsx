import clsx from 'clsx';

/**
 * Ready reasons (SYSTEM_5 review actions 4.3): one click fills the reason box, the reviewer can add to it. Used where a
 * person decides with a free reason (claim preparation, benefit choice).
 */
export function QuickReasons({ reasons, value, onPick }: { reasons: string[]; value: string; onPick: (text: string) => void }) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {reasons.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          aria-pressed={value === text}
          className={clsx(
            'rounded-full border px-3 py-1 text-left text-[13px] transition-colors',
            value === text ? 'border-ulink-orange bg-ulink-orange/10 text-slate-900' : 'border-slate-900/15 bg-white text-slate-700 hover:border-ulink-orange/60'
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
